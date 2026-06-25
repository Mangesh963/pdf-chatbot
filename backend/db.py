import sqlite3
import hashlib
import os

# Point to the root users.db to share between Streamlit and FastAPI, and prevent Uvicorn reload loops on DB writes
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "users.db")
_conn = None

def get_conn():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA synchronous=NORMAL")
        _conn.row_factory = sqlite3.Row
    return _conn

def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            email TEXT DEFAULT NULL,
            totp_secret TEXT DEFAULT NULL,
            totp_enabled INTEGER DEFAULT 0,
            email_2fa_enabled INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_label TEXT,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS email_otp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            otp TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id);
    """)
    # Migrate existing DB
    for col in [
        "ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN email_2fa_enabled INTEGER DEFAULT 0",
    ]:
        try:
            conn.execute(col); conn.commit()
        except Exception:
            pass
    conn.execute(
        "INSERT OR IGNORE INTO users (username, password, role) VALUES ('admin', ?, 'admin')",
        (hash_pw("admin123"),)
    )
    conn.commit()

def hash_pw(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def get_user_by_credentials(username: str, password: str):
    row = get_conn().execute(
        "SELECT id, username, role FROM users WHERE username=? AND password=?",
        (username, hash_pw(password))
    ).fetchone()
    return dict(row) if row else None

def get_user_by_id(user_id: int):
    row = get_conn().execute(
        "SELECT id, username, role FROM users WHERE id=?", (user_id,)
    ).fetchone()
    return dict(row) if row else None

def create_user(username: str, password: str):
    try:
        get_conn().execute(
            "INSERT INTO users (username, password) VALUES (?, ?)",
            (username, hash_pw(password))
        )
        get_conn().commit()
        return True, "Registered successfully."
    except sqlite3.IntegrityError:
        return False, "Username already exists."

def save_chat(user_id: int, question: str, answer: str, session_label: str = ""):
    conn = get_conn()
    conn.execute(
        "INSERT INTO chats (user_id, session_label, question, answer) VALUES (?, ?, ?, ?)",
        (user_id, session_label, question, answer)
    )
    conn.commit()

def get_user_chats(user_id: int):
    rows = get_conn().execute(
        "SELECT id, session_label, question, answer, created_at FROM chats WHERE user_id=? ORDER BY created_at DESC",
        (user_id,)
    ).fetchall()
    return [dict(r) for r in rows]

def get_all_users():
    rows = get_conn().execute(
        "SELECT id, username, role, created_at FROM users ORDER BY created_at DESC"
    ).fetchall()
    return [dict(r) for r in rows]

def get_all_chats():
    rows = get_conn().execute("""
        SELECT c.id, u.username, c.session_label, c.question, c.answer, c.created_at
        FROM chats c JOIN users u ON c.user_id = u.id
        ORDER BY c.created_at DESC
    """).fetchall()
    return [dict(r) for r in rows]

def delete_user(user_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM chats WHERE user_id=?", (user_id,))
    conn.execute("DELETE FROM users WHERE id=?", (user_id,))
    conn.commit()

def get_stats():
    conn = get_conn()
    return {
        "total_users": conn.execute("SELECT COUNT(*) FROM users WHERE role='user'").fetchone()[0],
        "total_chats": conn.execute("SELECT COUNT(*) FROM chats").fetchone()[0],
        "chats_today": conn.execute(
            "SELECT COUNT(*) FROM chats WHERE date(created_at)=date('now')"
        ).fetchone()[0],
    }

def get_user_2fa(user_id: int):
    row = get_conn().execute(
        "SELECT totp_secret, totp_enabled, email_2fa_enabled FROM users WHERE id=?", (user_id,)
    ).fetchone()
    return dict(row) if row else None

def set_totp_secret(user_id: int, secret: str):
    conn = get_conn()
    conn.execute("UPDATE users SET totp_secret=? WHERE id=?", (secret, user_id))
    conn.commit()

def enable_totp(user_id: int):
    conn = get_conn()
    conn.execute("UPDATE users SET totp_enabled=1 WHERE id=?", (user_id,))
    conn.commit()

def disable_totp(user_id: int):
    conn = get_conn()
    conn.execute("UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?", (user_id,))
    conn.commit()

def get_user_email(user_id: int) -> str:
    row = get_conn().execute("SELECT email FROM users WHERE id=?", (user_id,)).fetchone()
    return row["email"] if row else ""

def set_user_email(user_id: int, email: str):
    conn = get_conn()
    conn.execute("UPDATE users SET email=? WHERE id=?", (email, user_id))
    conn.commit()

def enable_email_2fa(user_id: int):
    conn = get_conn()
    conn.execute("UPDATE users SET email_2fa_enabled=1 WHERE id=?", (user_id,))
    conn.commit()

def disable_email_2fa(user_id: int):
    conn = get_conn()
    conn.execute("UPDATE users SET email_2fa_enabled=0 WHERE id=?", (user_id,))
    conn.commit()

def save_otp(user_id: int, otp: str, expires_at: str):
    conn = get_conn()
    conn.execute("DELETE FROM email_otp WHERE user_id=?", (user_id,))
    conn.execute("INSERT INTO email_otp (user_id, otp, expires_at) VALUES (?,?,?)",
                 (user_id, otp, expires_at))
    conn.commit()

def verify_otp(user_id: int, otp: str) -> bool:
    from datetime import datetime
    row = get_conn().execute(
        "SELECT otp, expires_at, used FROM email_otp WHERE user_id=? ORDER BY id DESC LIMIT 1",
        (user_id,)
    ).fetchone()
    if not row or row["used"]:
        return False
    if datetime.utcnow().isoformat() > row["expires_at"]:
        return False
    if row["otp"] != otp:
        return False
    get_conn().execute("UPDATE email_otp SET used=1 WHERE user_id=?", (user_id,))
    get_conn().commit()
    return True
