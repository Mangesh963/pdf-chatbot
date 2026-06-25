"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiLogin, apiRegister, apiVerify2FA, apiResendEmailOTP } from "@/lib/api";

export default function AuthPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  // 2FA
  const [needs2FA, setNeeds2FA] = useState(false);
  const [twoFAMethod, setTwoFAMethod] = useState<"totp" | "email">("totp");
  const [emailHint, setEmailHint] = useState("");
  const [partialToken, setPartialToken] = useState("");
  const [tfaCode, setTfaCode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  // Countdown timer for resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess("");
    if (tab === "register" && password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      if (tab === "login") {
        const data = await apiLogin(username, password);
        if (data.requires_2fa) {
          setPartialToken(data.partial_token);
          setTwoFAMethod(data.method || "totp");
          setEmailHint(data.email_hint || "");
          setNeeds2FA(true);
          if (data.method === "email") setResendCooldown(30);
        } else {
          localStorage.setItem("token", data.access_token);
          localStorage.setItem("role", data.role);
          localStorage.setItem("username", data.username);
          router.push(data.role === "admin" ? "/admin" : "/chat");
        }
      } else {
        await apiRegister(username, password);
        setSuccess("Account created! You can now log in.");
        setTab("login");
        setPassword(""); setConfirm("");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally { setLoading(false); }
  }

  async function handle2FASubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = await apiVerify2FA(partialToken, tfaCode);
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("role", data.role);
      localStorage.setItem("username", data.username);
      router.push(data.role === "admin" ? "/admin" : "/chat");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid code");
    } finally { setLoading(false); }
  }

  async function handleResend() {
    setError("");
    try {
      await apiResendEmailOTP();
      setResendCooldown(30);
      setSuccess("New code sent to your email.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to resend");
    }
  }

  // ── 2FA screen ───────────────────────────────────────────
  if (needs2FA) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-800 p-8 shadow-2xl space-y-6">
          <div className="text-center">
            <div className="text-4xl mb-3">{twoFAMethod === "email" ? "📧" : "🔐"}</div>
            <h2 className="text-xl font-bold text-white">Two-Factor Authentication</h2>
            <p className="text-gray-400 text-sm mt-1">
              {twoFAMethod === "email"
                ? <>Code sent to <span className="text-indigo-300 font-medium">{emailHint}</span></>
                : "Enter the 6-digit code from your authenticator app"}
            </p>
          </div>

          <form onSubmit={handle2FASubmit} className="space-y-4">
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-widest focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="000000"
              value={tfaCode}
              onChange={e => setTfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6} autoFocus required
            />

            {error && (
              <div className="flex items-center gap-2 bg-red-950 border border-red-800 rounded-lg px-3 py-2">
                <span className="text-red-400 text-xs">⚠</span>
                <p className="text-red-300 text-xs">{error}</p>
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 bg-green-950 border border-green-800 rounded-lg px-3 py-2">
                <span className="text-green-400 text-xs">✓</span>
                <p className="text-green-300 text-xs">{success}</p>
              </div>
            )}

            <button type="submit" disabled={loading || tfaCode.length !== 6}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl py-3 text-sm font-semibold transition-colors">
              {loading ? "Verifying..." : "Verify →"}
            </button>

            {twoFAMethod === "email" && (
              <button type="button" onClick={handleResend} disabled={resendCooldown > 0}
                className="w-full text-xs text-indigo-400 hover:text-indigo-300 disabled:text-gray-600 transition-colors py-1">
                {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "📧 Resend code"}
              </button>
            )}

            <button type="button" onClick={() => { setNeeds2FA(false); setTfaCode(""); setError(""); setSuccess(""); }}
              className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors">
              ← Back to login
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Main auth screen ─────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 flex">
      {/* Left panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-gradient-to-br from-indigo-900 via-indigo-800 to-gray-900 p-12">
        <div>
          <h1 className="text-3xl font-bold text-white">📚 PDF Knowledge Bot</h1>
          <p className="text-indigo-300 mt-2 text-sm">Your AI-powered document assistant</p>
        </div>
        <div className="space-y-6">
          {[
            { icon: "💬", title: "Chat with PDFs", desc: "Ask questions across multiple documents at once" },
            { icon: "🧠", title: "Quiz Generation", desc: "Auto-generate MCQ quizzes from your documents" },
            { icon: "📝", title: "Smart Notes", desc: "Structured study notes with key terms and summaries" },
            { icon: "📋", title: "Resume Analyzer", desc: "ATS scoring, improvements, and interview prep" },
            { icon: "🔐", title: "Two-Factor Auth", desc: "Secure your account with TOTP or Email OTP" },
          ].map(f => (
            <div key={f.title} className="flex items-start gap-3">
              <span className="text-2xl">{f.icon}</span>
              <div>
                <p className="text-white text-sm font-semibold">{f.title}</p>
                <p className="text-indigo-300 text-xs">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-indigo-400 text-xs">Powered by Gemini AI · Built for productivity</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center lg:hidden">
            <h1 className="text-2xl font-bold text-white">📚 PDF Knowledge Bot</h1>
            <p className="text-gray-400 text-sm mt-1">Your AI-powered document assistant</p>
          </div>

          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-1">
              {tab === "login" ? "Welcome back" : "Create account"}
            </h2>
            <p className="text-gray-400 text-sm mb-6">
              {tab === "login" ? "Sign in to your account" : "Get started for free"}
            </p>

            <div className="flex rounded-xl overflow-hidden border border-gray-700 mb-6">
              {(["login", "register"] as const).map(t => (
                <button key={t} onClick={() => { setTab(t); setError(""); setSuccess(""); }}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors
                                        ${tab === t ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"}`}>
                  {t === "login" ? "Sign In" : "Sign Up"}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Username</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">👤</span>
                  <input className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                    placeholder="Enter your username" value={username}
                    onChange={e => setUsername(e.target.value)} required autoComplete="username" />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Password</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔒</span>
                  <input type={showPass ? "text" : "password"}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-14 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                    placeholder="Enter your password" value={password}
                    onChange={e => setPassword(e.target.value)} required
                    autoComplete={tab === "login" ? "current-password" : "new-password"} />
                  <button type="button" onClick={() => setShowPass(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs">
                    {showPass ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {tab === "register" && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Confirm Password</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔒</span>
                    <input type={showPass ? "text" : "password"}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                      placeholder="Confirm your password" value={confirm}
                      onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 bg-red-950 border border-red-800 rounded-lg px-3 py-2">
                  <span className="text-red-400 text-xs">⚠</span>
                  <p className="text-red-300 text-xs">{error}</p>
                </div>
              )}
              {success && (
                <div className="flex items-center gap-2 bg-green-950 border border-green-800 rounded-lg px-3 py-2">
                  <span className="text-green-400 text-xs">✓</span>
                  <p className="text-green-300 text-xs">{success}</p>
                </div>
              )}

              <button type="submit" disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl py-3 text-sm font-semibold transition-colors mt-2">
                {loading ? "Please wait..." : tab === "login" ? "Sign In →" : "Create Account →"}
              </button>
            </form>

            <p className="text-center text-xs text-gray-500 mt-6">
              {tab === "login" ? "Don't have an account? " : "Already have an account? "}
              <button onClick={() => { setTab(tab === "login" ? "register" : "login"); setError(""); setSuccess(""); }}
                className="text-indigo-400 hover:text-indigo-300 font-medium">
                {tab === "login" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
