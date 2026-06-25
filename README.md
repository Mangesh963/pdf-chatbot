# PDF Knowledge Bot

PDF Knowledge Bot is a full-stack document assistant built with FastAPI and
Next.js. Users can upload PDF documents, ask grounded questions, generate
quizzes and study notes, inspect OCR results, and analyze resumes.

## Project structure

- `backend/` — FastAPI API, authentication, SQLite storage, RAG, OCR, resume
  analysis, and email/TOTP two-factor authentication.
- `frontend/` — Next.js user interface.

## Run locally

Create `backend/.env` with the required Gemini and email settings, then run:

```powershell
.\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

from the `backend` directory.

In a second terminal, run:

```powershell
npm install
npm run dev
```

from the `frontend` directory. Open `http://127.0.0.1:3000`.

API documentation is available at `http://127.0.0.1:8000/docs`.
