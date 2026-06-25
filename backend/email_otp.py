import os
import random
import string
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv

# Explicitly load from backend/.env regardless of working directory
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")


def generate_otp(length: int = 6) -> str:
    return "".join(random.choices(string.digits, k=length))


def otp_expiry() -> str:
    return (datetime.utcnow() + timedelta(minutes=10)).isoformat()


def send_otp_email(to_email: str, otp: str, username: str) -> bool:
    if not SMTP_USER or not SMTP_PASSWORD:
        raise ValueError("SMTP_USER and SMTP_PASSWORD must be set in backend/.env")

    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#1a1a2e;color:#e0e0e0;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:28px 32px">
        <h1 style="margin:0;font-size:22px;color:#fff">📚 PDF Knowledge Bot</h1>
        <p style="margin:6px 0 0;color:#c7d2fe;font-size:13px">Two-Factor Authentication</p>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 8px;color:#a0aec0;font-size:14px">Hi <strong style="color:#e2e8f0">{username}</strong>,</p>
        <p style="margin:0 0 24px;color:#a0aec0;font-size:14px">Your one-time verification code is:</p>
        <div style="background:#2d2d44;border:2px solid #4f46e5;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px">
          <span style="font-size:40px;font-weight:bold;letter-spacing:12px;color:#818cf8;font-family:monospace">{otp}</span>
        </div>
        <p style="margin:0 0 8px;color:#718096;font-size:12px">⏱ This code expires in <strong>10 minutes</strong>.</p>
        <p style="margin:0;color:#718096;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
      </div>
      <div style="padding:16px 32px;background:#12122a;text-align:center">
        <p style="margin:0;color:#4a5568;font-size:11px">PDF Knowledge Bot · Powered by Gemini AI</p>
      </div>
    </div>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Your verification code: {otp}"
    msg["From"] = f"PDF Knowledge Bot <{SMTP_USER}>"
    msg["To"] = to_email
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_USER, to_email, msg.as_string())
    return True
