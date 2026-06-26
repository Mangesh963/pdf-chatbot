import os
import pickle
import base64
import io
import csv
from contextlib import asynccontextmanager
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from db import (
    init_db, create_user, get_user_by_credentials,
    save_chat, get_user_chats, get_all_users, get_all_chats,
    delete_user, get_stats, get_user_2fa, set_totp_secret, enable_totp, disable_totp,
    get_user_email, set_user_email, enable_email_2fa, disable_email_2fa, save_otp, verify_otp
)
from auth import create_access_token, get_current_user, require_admin
from rag import build_vectorstore, query_vectorstore, generate_quiz, generate_notes, query_with_sources, extract_ocr_report
from resume import extract_resume_text, analyze_resume

load_dotenv()
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")

# Initialize Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL else None

# Supabase vectorstore functions
def save_vectorstore_to_db(user_id: int, vectorstore):
    """Serialize and save vectorstore to Supabase"""
    if not supabase:
        raise Exception("Supabase not configured")
    try:
        data = pickle.dumps(vectorstore)
        encoded = base64.b64encode(data).decode()
        supabase.table("vectorstores").upsert(
            {"user_id": user_id, "vectorstore_data": encoded}
        ).execute()
    except Exception as e:
        raise Exception(f"Failed to save vectorstore: {e}")

def load_vectorstore_from_db(user_id: int):
    """Retrieve and deserialize vectorstore from Supabase"""
    if not supabase:
        raise Exception("Supabase not configured")
    try:
        response = supabase.table("vectorstores").select("vectorstore_data").eq(
            "user_id", user_id
        ).single().execute()
        if not response.data:
            return None
        encoded = response.data["vectorstore_data"]
        data = base64.b64decode(encoded)
        return pickle.loads(data)
    except Exception as e:
        return None  # No vectorstore yet

# Define lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

# Create FastAPI app BEFORE defining routes
app = FastAPI(lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "https://pdf-chatbot-theta-seven.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Auth ----------

class AuthRequest(BaseModel):
    username: str
    password: str

@app.post("/api/auth/register")
def register(body: AuthRequest):
    ok, msg = create_user(body.username, body.password)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"message": msg}

@app.post("/api/auth/login")
def login(body: AuthRequest):
    user = get_user_by_credentials(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    tfa = get_user_2fa(user["id"])

    if tfa and tfa["totp_enabled"]:
        partial_token = create_access_token(user["id"], user["username"], user["role"])
        return {"requires_2fa": True, "method": "totp", "partial_token": partial_token, "username": user["username"]}

    if tfa and tfa.get("email_2fa_enabled"):
        partial_token = create_access_token(user["id"], user["username"], user["role"])
        from email_otp import generate_otp, otp_expiry, send_otp_email
        otp = generate_otp()
        save_otp(user["id"], otp, otp_expiry())
        email = get_user_email(user["id"])
        if not email:
            raise HTTPException(status_code=400, detail="No email configured for this account. Disable email 2FA first.")
        try:
            send_otp_email(email, otp, user["username"])
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to send OTP email: {e}")
        return {"requires_2fa": True, "method": "email", "partial_token": partial_token,
                "username": user["username"], "email_hint": email[:3] + "***@" + email.split("@")[-1]}

    token = create_access_token(user["id"], user["username"], user["role"])
    return {"access_token": token, "token_type": "bearer", "role": user["role"], "username": user["username"], "requires_2fa": False}

class TwoFAVerifyRequest(BaseModel):
    token: str
    code: str

@app.post("/api/auth/2fa/verify")
def verify_2fa(body: TwoFAVerifyRequest):
    """Verify TOTP or Email OTP and return full access token."""
    import pyotp
    from jose import jwt, JWTError
    from auth import SECRET_KEY, ALGORITHM
    try:
        payload = jwt.decode(body.token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    tfa = get_user_2fa(user_id)

    # Try TOTP first
    if tfa and tfa["totp_enabled"] and tfa["totp_secret"]:
        totp = pyotp.TOTP(tfa["totp_secret"])
        if not totp.verify(body.code, valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid authenticator code")
    # Try email OTP
    elif tfa and tfa.get("email_2fa_enabled"):
        if not verify_otp(user_id, body.code):
            raise HTTPException(status_code=401, detail="Invalid or expired email code")
    else:
        raise HTTPException(status_code=400, detail="2FA not enabled")

    from db import get_user_by_id
    user = get_user_by_id(user_id)
    token = create_access_token(user["id"], user["username"], user["role"])
    return {"access_token": token, "token_type": "bearer", "role": user["role"], "username": user["username"]}

@app.post("/api/auth/2fa/setup")
def setup_2fa(user=Depends(get_current_user)):
    """Generate a new TOTP secret and return QR code as base64 PNG."""
    import pyotp, qrcode
    secret = pyotp.random_base32()
    set_totp_secret(user["id"], secret)
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=user["username"], issuer_name="PDF Knowledge Bot")
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()
    return {"secret": secret, "qr_code": f"data:image/png;base64,{qr_b64}"}

class TwoFAEnableRequest(BaseModel):
    code: str

@app.post("/api/auth/2fa/enable")
def enable_2fa(body: TwoFAEnableRequest, user=Depends(get_current_user)):
    """Confirm TOTP code and activate 2FA."""
    import pyotp
    tfa = get_user_2fa(user["id"])
    if not tfa or not tfa["totp_secret"]:
        raise HTTPException(status_code=400, detail="Run /setup first")
    totp = pyotp.TOTP(tfa["totp_secret"])
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid code — try again")
    enable_totp(user["id"])
    return {"message": "2FA enabled successfully"}

@app.post("/api/auth/2fa/disable")
def disable_2fa(body: TwoFAEnableRequest, user=Depends(get_current_user)):
    """Disable 2FA after verifying current code."""
    import pyotp
    tfa = get_user_2fa(user["id"])
    if not tfa or not tfa["totp_enabled"]:
        raise HTTPException(status_code=400, detail="2FA is not enabled")
    totp = pyotp.TOTP(tfa["totp_secret"])
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid code")
    disable_totp(user["id"])
    return {"message": "2FA disabled"}

@app.get("/api/auth/2fa/status")
def twofa_status(user=Depends(get_current_user)):
    tfa = get_user_2fa(user["id"])
    email = get_user_email(user["id"])
    return {
        "totp_enabled": bool(tfa and tfa["totp_enabled"]),
        "email_2fa_enabled": bool(tfa and tfa.get("email_2fa_enabled")),
        "email": email or "",
    }

# ── Email 2FA ──────────────────────────────────────────────

class EmailSetupRequest(BaseModel):
    email: str

@app.post("/api/auth/2fa/email/setup")
def setup_email_2fa(body: EmailSetupRequest, user=Depends(get_current_user)):
    """Save email and send a verification OTP."""
    from email_otp import generate_otp, otp_expiry, send_otp_email
    import re
    if not re.match(r"[^@]+@[^@]+\.[^@]+", body.email):
        raise HTTPException(status_code=400, detail="Invalid email address")
    set_user_email(user["id"], body.email)
    otp = generate_otp()
    save_otp(user["id"], otp, otp_expiry())
    try:
        send_otp_email(body.email, otp, user["username"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {e}")
    return {"message": "OTP sent to your email"}

@app.post("/api/auth/2fa/email/enable")
def enable_email_2fa_endpoint(body: TwoFAEnableRequest, user=Depends(get_current_user)):
    """Verify OTP and activate email 2FA."""
    if not verify_otp(user["id"], body.code):
        raise HTTPException(status_code=401, detail="Invalid or expired code")
    enable_email_2fa(user["id"])
    return {"message": "Email 2FA enabled successfully"}

@app.post("/api/auth/2fa/email/resend")
def resend_email_otp(user=Depends(get_current_user)):
    """Resend OTP to saved email."""
    from email_otp import generate_otp, otp_expiry, send_otp_email
    email = get_user_email(user["id"])
    if not email:
        raise HTTPException(status_code=400, detail="No email saved. Run setup first.")
    otp = generate_otp()
    save_otp(user["id"], otp, otp_expiry())
    try:
        send_otp_email(email, otp, user["username"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {e}")
    return {"message": "OTP resent"}

@app.post("/api/auth/2fa/email/disable")
def disable_email_2fa_endpoint(body: TwoFAEnableRequest, user=Depends(get_current_user)):
    """Verify OTP then disable email 2FA."""
    if not verify_otp(user["id"], body.code):
        raise HTTPException(status_code=401, detail="Invalid or expired code")
    disable_email_2fa(user["id"])
    return {"message": "Email 2FA disabled"}

@app.get("/api/auth/me")
def me(user=Depends(get_current_user)):
    return user

# ---------- PDF Upload ----------

@app.post("/api/upload")
async def upload_pdfs(
    files: list[UploadFile] = File(...),
    user=Depends(get_current_user)
):
    try:
        file_data = [(await f.read(), f.filename) for f in files]
        vs = build_vectorstore(file_data)
        save_vectorstore_to_db(user["id"], vs)
        return {"message": f"Indexed {len(files)} file(s)"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ---------- Chat ----------

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    question: str
    session_label: str = ""
    history: list[ChatMessage] = []

@app.post("/api/chat")
def chat(body: ChatRequest, user=Depends(get_current_user)):
    vs = load_vectorstore_from_db(user["id"])
    if not vs:
        raise HTTPException(status_code=400, detail="No documents uploaded. Please upload PDFs first.")
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY not set in backend/.env")
    try:
        history = [{"role": m.role, "content": m.content} for m in body.history]
        answer, sources = query_with_sources(vs, body.question, GOOGLE_API_KEY, history)
        save_chat(user["id"], body.question, answer, body.session_label)
        return {"answer": answer, "sources": sources}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ---------- Quiz ----------

class QuizRequest(BaseModel):
    num_questions: int = 5

@app.post("/api/quiz")
def quiz(body: QuizRequest, user=Depends(get_current_user)):
    vs = load_vectorstore_from_db(user["id"])
    if not vs:
        raise HTTPException(status_code=400, detail="No documents uploaded.")
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY not set in backend/.env")
    try:
        return {"quiz": generate_quiz(vs, GOOGLE_API_KEY, body.num_questions)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ---------- Notes ----------

@app.post("/api/notes")
def notes(user=Depends(get_current_user)):
    vs = load_vectorstore_from_db(user["id"])
    if not vs:
        raise HTTPException(status_code=400, detail="No documents uploaded.")
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY not set in backend/.env")
    try:
        return {"notes": generate_notes(vs, GOOGLE_API_KEY)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/chat/clear")
def clear_vectorstore(user=Depends(get_current_user)):
    if supabase:
        supabase.table("vectorstores").delete().eq("user_id", user["id"]).execute()
    return {"message": "Knowledge base cleared"}

@app.get("/api/chat/history")
def chat_history(user=Depends(get_current_user)):
    return get_user_chats(user["id"])

# ---------- OCR ----------

@app.post("/api/ocr")
async def ocr_pdf(file: UploadFile = File(...), user=Depends(get_current_user)):
    """Run full OCR analysis on a single PDF and return per-page results."""
    file_bytes = await file.read()
    try:
        report = extract_ocr_report(file_bytes, file.filename, api_key=GOOGLE_API_KEY)
        return {"filename": file.filename, "pages": len(report), "report": report}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class DiagramRequest(BaseModel):
    ocr_text: str

@app.post("/api/ocr/explain")
def explain_diagram(body: DiagramRequest, user=Depends(get_current_user)):
    """Ask Gemini to explain text extracted from a diagram/image."""
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY not set")
    try:
        from langchain_core.prompts import ChatPromptTemplate
        from langchain_core.output_parsers import StrOutputParser
        from rag import get_llm
        llm = get_llm(GOOGLE_API_KEY)
        prompt = ChatPromptTemplate.from_messages([
            ("system",
             "You are an expert at interpreting text extracted from diagrams, charts, figures, and images in documents.\n"
             "The following text was extracted via OCR from an image or diagram in a PDF.\n"
             "Explain what this diagram/image likely represents, what the key data or concepts are, "
             "and what insights can be drawn from it. Format your response clearly with sections."),
            ("human", "OCR extracted text:\n\n{ocr_text}\n\nPlease explain this diagram/image."),
        ])
        chain = prompt | llm | StrOutputParser()
        explanation = chain.invoke({"ocr_text": body.ocr_text})
        return {"explanation": explanation}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ---------- Resume Analyzer ----------

@app.post("/api/resume/analyze")
async def resume_analyze(
    file: UploadFile = File(...),
    job_description: str = "",
    user=Depends(get_current_user)
):
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY not set in backend/.env")
    file_bytes = await file.read()
    try:
        resume_text = extract_resume_text(file_bytes)
        if not resume_text.strip():
            raise HTTPException(status_code=400, detail="Could not extract text from PDF. Try a text-based resume.")
        result = analyze_resume(resume_text, job_description, GOOGLE_API_KEY)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ---------- Admin ----------
@app.get("/api/admin/stats")
def admin_stats(user=Depends(require_admin)):
    return get_stats()

@app.get("/api/admin/users")
def admin_users(user=Depends(require_admin)):
    return get_all_users()

@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, user=Depends(require_admin)):
    delete_user(user_id)
    return {"message": "User deleted"}

@app.get("/api/admin/chats")
def admin_chats(user=Depends(require_admin)):
    return get_all_chats()

@app.get("/api/admin/report/csv")
def admin_report_csv(user=Depends(require_admin)):
    users = get_all_users()
    chats = get_all_chats()
    stats = get_stats()

    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(["ADMIN REPORT", f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}"])
    w.writerow(["Total Users", stats["total_users"]])
    w.writerow(["Total Chats", stats["total_chats"]])
    w.writerow(["Chats Today", stats["chats_today"]])
    w.writerow([])
    w.writerow(["ID", "Username", "Role", "Registered At"])
    for u in users:
        w.writerow([u["id"], u["username"], u["role"], u["created_at"]])
    w.writerow([])
    w.writerow(["ID", "Username", "Session", "Question", "Answer", "Date"])
    for c in chats:
        w.writerow([c["id"], c["username"], c.get("session_label",""), c["question"], c["answer"], c["created_at"]])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=report_{datetime.now().strftime('%Y-%m-%d')}.csv"}
    )

@app.get("/")
def root():
    return {"message": "PDF Chatbot API is running"}
