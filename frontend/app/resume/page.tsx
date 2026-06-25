"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiAnalyzeResume } from "@/lib/api";

type ScoreBreakdown = { keywords: number; formatting: number; experience: number; skills: number; education: number };
type Improvement = { issue: string; suggestion: string; priority: "high" | "medium" | "low" };
type InterviewQ = { question: string; category: string; tip: string };
type ResumeResult = {
    ats_score: number;
    score_breakdown: ScoreBreakdown;
    strengths: string[];
    improvements: Improvement[];
    missing_keywords: string[];
    interview_questions: InterviewQ[];
    overall_summary: string;
    recommended_roles: string[];
};

function ScoreRing({ score }: { score: number }) {
    const color = score >= 75 ? "text-green-400" : score >= 50 ? "text-yellow-400" : "text-red-400";
    const ring = score >= 75 ? "border-green-500" : score >= 50 ? "border-yellow-500" : "border-red-500";
    return (
        <div className={`w-32 h-32 rounded-full border-8 ${ring} flex flex-col items-center justify-center`}>
            <span className={`text-3xl font-bold ${color}`}>{score}</span>
            <span className="text-xs text-gray-400">/ 100</span>
        </div>
    );
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
    const pct = Math.round((value / max) * 100);
    const color = pct >= 75 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";
    return (
        <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
                <span>{label}</span><span>{value}/{max}</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

const priorityStyle = { high: "bg-red-900 text-red-300 border-red-700", medium: "bg-yellow-900 text-yellow-300 border-yellow-700", low: "bg-blue-900 text-blue-300 border-blue-700" };
const categoryStyle: Record<string, string> = { technical: "bg-indigo-900 text-indigo-300", behavioral: "bg-purple-900 text-purple-300", situational: "bg-teal-900 text-teal-300" };

export default function ResumePage() {
    const router = useRouter();
    const [file, setFile] = useState<File | null>(null);
    const [jd, setJd] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<ResumeResult | null>(null);
    const [error, setError] = useState("");
    const [activeTab, setActiveTab] = useState<"overview" | "improvements" | "interview">("overview");

    useEffect(() => {
        if (!localStorage.getItem("token")) router.push("/");
    }, [router]);

    async function handleAnalyze() {
        if (!file) return;
        setLoading(true); setError(""); setResult(null);
        try {
            const data = await apiAnalyzeResume(file, jd);
            setResult(data);
            setActiveTab("overview");
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Analysis failed");
        } finally { setLoading(false); }
    }

    function downloadReport() {
        if (!result) return;
        const lines = [
            `RESUME ANALYSIS REPORT`,
            `${"=".repeat(50)}`,
            `ATS Score: ${result.ats_score}/100`,
            ``,
            `SUMMARY`,
            result.overall_summary,
            ``,
            `STRENGTHS`,
            ...result.strengths.map(s => `• ${s}`),
            ``,
            `IMPROVEMENTS`,
            ...result.improvements.map(i => `[${i.priority.toUpperCase()}] ${i.issue}\n  → ${i.suggestion}`),
            ``,
            `MISSING KEYWORDS`,
            result.missing_keywords.join(", "),
            ``,
            `RECOMMENDED ROLES`,
            result.recommended_roles.join(", "),
            ``,
            `INTERVIEW QUESTIONS`,
            ...result.interview_questions.map((q, i) => `Q${i + 1}. [${q.category}] ${q.question}\nTip: ${q.tip}`),
        ];
        const blob = new Blob([lines.join("\n")], { type: "text/plain" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
        a.download = "resume_analysis.txt"; a.click();
    }

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100">
            {/* Header */}
            <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button onClick={() => router.push("/chat")} className="text-gray-400 hover:text-white text-sm transition-colors">← Back</button>
                    <h1 className="text-xl font-bold">📋 Resume Analyzer</h1>
                </div>
                <button onClick={() => { localStorage.clear(); router.push("/"); }} className="text-sm text-gray-400 hover:text-white">Logout</button>
            </header>

            <div className="max-w-5xl mx-auto p-6 space-y-6">
                {/* Upload Section */}
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
                    <h2 className="font-semibold text-gray-200">Upload Resume</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Resume PDF *</label>
                            <label className={`flex items-center gap-3 border-2 border-dashed rounded-xl px-4 py-6 cursor-pointer transition-colors
                                ${file ? "border-green-500 bg-green-950" : "border-gray-700 hover:border-indigo-500"}`}>
                                <span className="text-2xl">{file ? "✅" : "📄"}</span>
                                <div>
                                    <p className="text-sm font-medium">{file ? file.name : "Click to upload resume"}</p>
                                    <p className="text-xs text-gray-500">{file ? `${(file.size / 1024).toFixed(1)} KB` : "PDF format only"}</p>
                                </div>
                                <input type="file" accept=".pdf" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
                            </label>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Job Description <span className="text-red-400">*</span> <span className="text-gray-600">(required for analysis)</span></label>
                            <textarea
                                className="w-full h-32 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-indigo-500"
                                placeholder="Paste the job description here for targeted ATS analysis..."
                                value={jd} onChange={e => setJd(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={handleAnalyze} disabled={!file || !jd.trim() || loading}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors">
                            {loading ? "⏳ Analyzing..." : "🚀 Analyze Resume"}
                        </button>
                        {file && !jd.trim() && (
                            <p className="text-yellow-400 text-xs">⚠ Please fill in the Job Description to enable analysis</p>
                        )}
                        {result && (
                            <button onClick={downloadReport} className="bg-gray-700 hover:bg-gray-600 px-4 py-2.5 rounded-lg text-sm transition-colors">
                                ⬇ Download Report
                            </button>
                        )}
                    </div>
                    {error && <p className="text-red-400 text-sm">{error}</p>}
                </div>

                {/* Results */}
                {result && (
                    <div className="space-y-6">
                        {/* Score + Summary */}
                        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
                            <div className="flex flex-col md:flex-row gap-6 items-start">
                                <div className="flex flex-col items-center gap-2">
                                    <ScoreRing score={result.ats_score} />
                                    <p className="text-xs text-gray-400 text-center">ATS Score</p>
                                    <span className={`text-xs font-semibold px-3 py-1 rounded-full ${result.ats_score >= 75 ? "bg-green-900 text-green-300" : result.ats_score >= 50 ? "bg-yellow-900 text-yellow-300" : "bg-red-900 text-red-300"}`}>
                                        {result.ats_score >= 75 ? "Strong" : result.ats_score >= 50 ? "Average" : "Needs Work"}
                                    </span>
                                </div>
                                <div className="flex-1 space-y-3">
                                    <h3 className="font-semibold text-gray-200">Score Breakdown</h3>
                                    {result.score_breakdown && Object.entries({
                                        "Keywords Match": [result.score_breakdown.keywords, 25],
                                        "Formatting": [result.score_breakdown.formatting, 20],
                                        "Experience": [result.score_breakdown.experience, 25],
                                        "Skills": [result.score_breakdown.skills, 20],
                                        "Education": [result.score_breakdown.education, 10],
                                    }).map(([label, [val, max]]) => (
                                        <ScoreBar key={label} label={label} value={val as number} max={max as number} />
                                    ))}
                                </div>
                            </div>
                            <div className="mt-4 bg-gray-800 rounded-lg p-4 text-sm text-gray-200">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.overall_summary}</ReactMarkdown>
                            </div>
                        </div>

                        {/* Tabs */}
                        <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800 w-fit">
                            {(["overview", "improvements", "interview"] as const).map(t => (
                                <button key={t} onClick={() => setActiveTab(t)}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${activeTab === t ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}>
                                    {t === "overview" ? "💪 Strengths" : t === "improvements" ? "🔧 Improvements" : "🎤 Interview Prep"}
                                </button>
                            ))}
                        </div>

                        {/* Strengths */}
                        {activeTab === "overview" && (
                            <div className="space-y-4">
                                <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
                                    <h3 className="font-semibold text-green-400 mb-3">✅ Strengths</h3>
                                    <ul className="space-y-2">
                                        {result.strengths.map((s, i) => (
                                            <li key={i} className="flex items-start gap-2 text-sm text-gray-200">
                                                <span className="text-green-400 mt-0.5">•</span>{s}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                {result.missing_keywords.length > 0 && (
                                    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
                                        <h3 className="font-semibold text-yellow-400 mb-3">🔑 Missing Keywords</h3>
                                        <div className="flex flex-wrap gap-2">
                                            {result.missing_keywords.map((k, i) => (
                                                <span key={i} className="bg-yellow-900 text-yellow-300 border border-yellow-700 px-3 py-1 rounded-full text-xs">{k}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {result.recommended_roles.length > 0 && (
                                    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
                                        <h3 className="font-semibold text-indigo-400 mb-3">🎯 Recommended Roles</h3>
                                        <div className="flex flex-wrap gap-2">
                                            {result.recommended_roles.map((r, i) => (
                                                <span key={i} className="bg-indigo-900 text-indigo-300 border border-indigo-700 px-3 py-1 rounded-full text-xs">{r}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Improvements */}
                        {activeTab === "improvements" && (
                            <div className="space-y-3">
                                {result.improvements.map((imp, i) => (
                                    <div key={i} className={`bg-gray-900 rounded-xl border p-4 ${priorityStyle[imp.priority]}`}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1">
                                                <p className="text-sm font-semibold text-gray-100 mb-1">⚠ {imp.issue}</p>
                                                <p className="text-sm text-gray-300">→ {imp.suggestion}</p>
                                            </div>
                                            <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${priorityStyle[imp.priority]}`}>
                                                {imp.priority}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Interview Questions */}
                        {activeTab === "interview" && (
                            <div className="space-y-3">
                                {result.interview_questions.map((q, i) => (
                                    <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-2">
                                        <div className="flex items-start justify-between gap-3">
                                            <p className="text-sm font-semibold text-gray-100">Q{i + 1}. {q.question}</p>
                                            <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${categoryStyle[q.category] || "bg-gray-700 text-gray-300"}`}>
                                                {q.category}
                                            </span>
                                        </div>
                                        <div className="flex items-start gap-2 bg-indigo-950 border border-indigo-800 rounded-lg px-3 py-2">
                                            <span className="text-indigo-400 text-xs mt-0.5">💡</span>
                                            <p className="text-xs text-indigo-200">{q.tip}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
