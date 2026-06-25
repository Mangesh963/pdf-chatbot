"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
    apiSetup2FA, apiEnable2FA, apiDisable2FA, api2FAStatus,
    apiSetupEmail2FA, apiEnableEmail2FA, apiDisableEmail2FA, apiResendEmailOTP
} from "@/lib/api";

type Status = { totp_enabled: boolean; email_2fa_enabled: boolean; email: string };
type Step = "idle" | "totp-setup" | "totp-confirm" | "totp-disable" | "email-setup" | "email-confirm" | "email-disable";

export default function SettingsPage() {
    const router = useRouter();
    const [status, setStatus] = useState<Status | null>(null);
    const [step, setStep] = useState<Step>("idle");
    const [qrCode, setQrCode] = useState("");
    const [secret, setSecret] = useState("");
    const [code, setCode] = useState("");
    const [email, setEmail] = useState("");
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [loading, setLoading] = useState(false);
    const username = typeof window !== "undefined" ? localStorage.getItem("username") : "";

    useEffect(() => {
        if (!localStorage.getItem("token")) { router.push("/"); return; }
        api2FAStatus().then(s => { setStatus(s); setEmail(s.email || ""); });
    }, [router]);

    function reset() { setStep("idle"); setCode(""); setError(""); setSuccess(""); }

    async function run(fn: () => Promise<void>) {
        setError(""); setLoading(true);
        try { await fn(); } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
        finally { setLoading(false); }
    }

    async function startTOTP() {
        await run(async () => {
            const d = await apiSetup2FA();
            setQrCode(d.qr_code); setSecret(d.secret); setStep("totp-setup");
        });
    }

    async function confirmTOTP() {
        await run(async () => {
            await apiEnable2FA(code);
            setStatus(s => s ? { ...s, totp_enabled: true } : s);
            setSuccess("Authenticator app 2FA enabled!"); reset();
        });
    }

    async function disableTOTP() {
        await run(async () => {
            await apiDisable2FA(code);
            setStatus(s => s ? { ...s, totp_enabled: false } : s);
            setSuccess("Authenticator app 2FA disabled."); reset();
        });
    }

    async function sendEmailOTP() {
        await run(async () => {
            await apiSetupEmail2FA(email);
            setStep("email-confirm");
        });
    }

    async function confirmEmail() {
        await run(async () => {
            await apiEnableEmail2FA(code);
            setStatus(s => s ? { ...s, email_2fa_enabled: true, email } : s);
            setSuccess("Email 2FA enabled!"); reset();
        });
    }

    async function disableEmail() {
        await run(async () => {
            await apiDisableEmail2FA(code);
            setStatus(s => s ? { ...s, email_2fa_enabled: false } : s);
            setSuccess("Email 2FA disabled."); reset();
        });
    }

    if (!status) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">Loading...</div>;

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100">
            <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button onClick={() => router.push("/chat")} className="text-gray-400 hover:text-white text-sm">← Back</button>
                    <h1 className="text-xl font-bold">⚙️ Security Settings</h1>
                </div>
                <span className="text-sm text-gray-400">👤 {username}</span>
            </header>

            <div className="max-w-2xl mx-auto p-6 space-y-5">
                {success && (
                    <div className="flex items-center gap-2 bg-green-950 border border-green-800 rounded-lg px-4 py-3">
                        <span className="text-green-400">✓</span>
                        <p className="text-green-300 text-sm">{success}</p>
                    </div>
                )}
                {error && (
                    <div className="flex items-center gap-2 bg-red-950 border border-red-800 rounded-lg px-4 py-3">
                        <span className="text-red-400">⚠</span>
                        <p className="text-red-300 text-sm">{error}</p>
                    </div>
                )}

                {/* ── TOTP Card ── */}
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="font-semibold text-gray-100 flex items-center gap-2">
                                📱 Authenticator App (TOTP)
                                <span className={`text-xs px-2 py-0.5 rounded-full ${status.totp_enabled ? "bg-green-900 text-green-300" : "bg-gray-700 text-gray-400"}`}>
                                    {status.totp_enabled ? "Enabled" : "Disabled"}
                                </span>
                            </h2>
                            <p className="text-xs text-gray-400 mt-1">Use Google Authenticator, Authy, or any TOTP app.</p>
                        </div>
                    </div>

                    {step === "idle" && (
                        !status.totp_enabled
                            ? <button onClick={startTOTP} className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors">Enable Authenticator App</button>
                            : <button onClick={() => setStep("totp-disable")} className="bg-red-900 hover:bg-red-800 border border-red-700 text-red-300 px-4 py-2 rounded-lg text-sm transition-colors">Disable</button>
                    )}

                    {step === "totp-setup" && (
                        <div className="space-y-4">
                            <div className="bg-gray-800 rounded-xl p-4 space-y-3">
                                <p className="text-sm font-medium">Step 1 — Scan QR code</p>
                                {qrCode && <div className="flex justify-center bg-white p-3 rounded-xl w-fit mx-auto"><Image src={qrCode} alt="QR" width={180} height={180} /></div>}
                                <div className="bg-gray-900 rounded-lg p-3">
                                    <p className="text-xs text-gray-400 mb-1">Manual key:</p>
                                    <p className="font-mono text-sm text-indigo-300 tracking-widest break-all">{secret}</p>
                                </div>
                            </div>
                            <div className="bg-gray-800 rounded-xl p-4 space-y-3">
                                <p className="text-sm font-medium">Step 2 — Enter 6-digit code to confirm</p>
                                <input className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-widest focus:outline-none focus:border-indigo-500"
                                    placeholder="000000" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} autoFocus />
                                <div className="flex gap-3">
                                    <button onClick={confirmTOTP} disabled={code.length !== 6 || loading}
                                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 py-2.5 rounded-lg text-sm font-medium transition-colors">
                                        {loading ? "Activating..." : "Activate"}
                                    </button>
                                    <button onClick={reset} className="px-4 py-2.5 rounded-lg text-sm bg-gray-700 hover:bg-gray-600 transition-colors">Cancel</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === "totp-disable" && (
                        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
                            <p className="text-sm font-medium">Enter your current authenticator code to disable</p>
                            <input className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-widest focus:outline-none focus:border-red-500"
                                placeholder="000000" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} autoFocus />
                            <div className="flex gap-3">
                                <button onClick={disableTOTP} disabled={code.length !== 6 || loading}
                                    className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-40 py-2.5 rounded-lg text-sm font-medium transition-colors">
                                    {loading ? "Disabling..." : "Confirm Disable"}
                                </button>
                                <button onClick={reset} className="px-4 py-2.5 rounded-lg text-sm bg-gray-700 hover:bg-gray-600 transition-colors">Cancel</button>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Email OTP Card ── */}
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="font-semibold text-gray-100 flex items-center gap-2">
                                📧 Email OTP
                                <span className={`text-xs px-2 py-0.5 rounded-full ${status.email_2fa_enabled ? "bg-green-900 text-green-300" : "bg-gray-700 text-gray-400"}`}>
                                    {status.email_2fa_enabled ? "Enabled" : "Disabled"}
                                </span>
                            </h2>
                            <p className="text-xs text-gray-400 mt-1">Receive a one-time code on your email at every login.</p>
                        </div>
                    </div>

                    {step === "idle" && (
                        !status.email_2fa_enabled
                            ? <button onClick={() => setStep("email-setup")} className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors">Enable Email OTP</button>
                            : <div className="flex items-center gap-3">
                                <span className="text-xs text-gray-400">Sending to: <span className="text-gray-200">{status.email}</span></span>
                                <button onClick={() => setStep("email-disable")} className="bg-red-900 hover:bg-red-800 border border-red-700 text-red-300 px-4 py-2 rounded-lg text-sm transition-colors">Disable</button>
                            </div>
                    )}

                    {step === "email-setup" && (
                        <div className="space-y-3">
                            <p className="text-sm font-medium">Enter your email address</p>
                            <input type="email" className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
                                placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
                            <div className="flex gap-3">
                                <button onClick={sendEmailOTP} disabled={!email || loading}
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 py-2.5 rounded-lg text-sm font-medium transition-colors">
                                    {loading ? "Sending..." : "Send Verification Code"}
                                </button>
                                <button onClick={reset} className="px-4 py-2.5 rounded-lg text-sm bg-gray-700 hover:bg-gray-600 transition-colors">Cancel</button>
                            </div>
                        </div>
                    )}

                    {step === "email-confirm" && (
                        <div className="space-y-3">
                            <p className="text-sm font-medium">Enter the code sent to <span className="text-indigo-300">{email}</span></p>
                            <input className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-widest focus:outline-none focus:border-indigo-500"
                                placeholder="000000" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} autoFocus />
                            <div className="flex gap-3">
                                <button onClick={confirmEmail} disabled={code.length !== 6 || loading}
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 py-2.5 rounded-lg text-sm font-medium transition-colors">
                                    {loading ? "Verifying..." : "Activate Email OTP"}
                                </button>
                                <button onClick={() => apiResendEmailOTP().catch(() => { })}
                                    className="px-4 py-2.5 rounded-lg text-sm bg-gray-700 hover:bg-gray-600 transition-colors">Resend</button>
                                <button onClick={reset} className="px-4 py-2.5 rounded-lg text-sm bg-gray-700 hover:bg-gray-600 transition-colors">Cancel</button>
                            </div>
                        </div>
                    )}

                    {step === "email-disable" && (
                        <div className="space-y-3">
                            <p className="text-sm font-medium">A code will be sent to <span className="text-indigo-300">{status.email}</span></p>
                            <button onClick={async () => { await apiResendEmailOTP(); setStep("email-disable-confirm" as Step); }}
                                className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                                Send Code to Disable
                            </button>
                            <button onClick={reset} className="ml-3 text-sm text-gray-400 hover:text-white">Cancel</button>
                        </div>
                    )}

                    {(step as string) === "email-disable-confirm" && (
                        <div className="space-y-3">
                            <p className="text-sm font-medium">Enter the code sent to your email</p>
                            <input className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-widest focus:outline-none focus:border-red-500"
                                placeholder="000000" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} autoFocus />
                            <div className="flex gap-3">
                                <button onClick={disableEmail} disabled={code.length !== 6 || loading}
                                    className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-40 py-2.5 rounded-lg text-sm font-medium transition-colors">
                                    {loading ? "Disabling..." : "Confirm Disable"}
                                </button>
                                <button onClick={reset} className="px-4 py-2.5 rounded-lg text-sm bg-gray-700 hover:bg-gray-600 transition-colors">Cancel</button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Info */}
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
                    <h3 className="text-sm font-semibold text-gray-300 mb-3">ℹ️ About Two-Factor Authentication</h3>
                    <div className="space-y-2 text-xs text-gray-400">
                        <p>• <strong className="text-gray-300">Authenticator App</strong> — works offline, most secure, no email needed</p>
                        <p>• <strong className="text-gray-300">Email OTP</strong> — code sent to your inbox, expires in 10 minutes</p>
                        <p>• Only one method can be active at a time. Enable one before disabling the other.</p>
                        <p>• To set up email OTP, add your Gmail App Password in <code className="bg-gray-800 px-1 rounded">backend/.env</code></p>
                    </div>
                </div>
            </div>
        </div>
    );
}
