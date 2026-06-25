const BASE = "https://pdf-chatbot-production-1a6c.up.railway.app";

function getToken() {
    return typeof window !== "undefined" ? localStorage.getItem("token") : null;
}

function authHeaders() {
    return { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" };
}

export async function apiLogin(username: string, password: string) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json(); // { requires_2fa, partial_token?, access_token?, role, username }
}

export async function apiVerify2FA(token: string, code: string) {
    const res = await fetch(`${BASE}/api/auth/2fa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function apiSetup2FA() {
    const res = await fetch(`${BASE}/api/auth/2fa/setup`, { method: "POST", headers: authHeaders() });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json(); // { secret, qr_code }
}

export async function apiEnable2FA(code: string) {
    const res = await fetch(`${BASE}/api/auth/2fa/enable`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function apiDisable2FA(code: string) {
    const res = await fetch(`${BASE}/api/auth/2fa/disable`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function api2FAStatus() {
    const res = await fetch(`${BASE}/api/auth/2fa/status`, { headers: authHeaders() });
    return res.json(); // { totp_enabled, email_2fa_enabled, email }
}

export async function apiSetupEmail2FA(email: string) {
    const res = await fetch(`${BASE}/api/auth/2fa/email/setup`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function apiEnableEmail2FA(code: string) {
    const res = await fetch(`${BASE}/api/auth/2fa/email/enable`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function apiDisableEmail2FA(code: string) {
    const res = await fetch(`${BASE}/api/auth/2fa/email/disable`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function apiResendEmailOTP() {
    const res = await fetch(`${BASE}/api/auth/2fa/email/resend`, { method: "POST", headers: authHeaders() });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function apiRegister(username: string, password: string) {
    const res = await fetch(`${BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function apiUpload(files: File[]) {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    const res = await fetch(`${BASE}/api/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
    });
    if (res.status === 401) {
        localStorage.clear();
        window.location.href = "/";
        throw new Error("Session expired. Please log in again.");
    }
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function apiChat(question: string, sessionLabel: string, history: { role: string, content: string }[]) {
    const res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ question, session_label: sessionLabel, history }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json(); // { answer, sources }
}

export async function apiQuiz(numQuestions: number = 5) {
    const res = await fetch(`${BASE}/api/quiz`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ num_questions: numQuestions }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function apiNotes() {
    const res = await fetch(`${BASE}/api/notes`, {
        method: "POST",
        headers: authHeaders(),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function apiClearKB() {
    await fetch(`${BASE}/api/chat/clear`, { method: "DELETE", headers: authHeaders() });
}

export async function apiHistory() {
    const res = await fetch(`${BASE}/api/chat/history`, { headers: authHeaders() });
    return res.json();
}

export async function apiAdminStats() {
    const res = await fetch(`${BASE}/api/admin/stats`, { headers: authHeaders() });
    return res.json();
}

export async function apiAdminUsers() {
    const res = await fetch(`${BASE}/api/admin/users`, { headers: authHeaders() });
    return res.json();
}

export async function apiAdminChats() {
    const res = await fetch(`${BASE}/api/admin/chats`, { headers: authHeaders() });
    return res.json();
}

export async function apiDeleteUser(userId: number) {
    await fetch(`${BASE}/api/admin/users/${userId}`, { method: "DELETE", headers: authHeaders() });
}

export async function apiOcr(file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/api/ocr`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function apiExplainDiagram(ocrText: string) {
    const res = await fetch(`${BASE}/api/ocr/explain`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ocr_text: ocrText }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function apiAnalyzeResume(file: File, jobDescription: string) {
    const form = new FormData();
    form.append("file", file);
    form.append("job_description", jobDescription);
    const res = await fetch(`${BASE}/api/resume/analyze`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
}

export async function downloadAdminCsv() {
    const res = await fetch(`${BASE}/api/admin/report/csv`, { headers: authHeaders() });
    if (!res.ok) throw new Error((await res.json()).detail);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `admin_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
