"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiUpload, apiChat, apiClearKB, apiHistory, apiQuiz, apiNotes, apiOcr, apiExplainDiagram } from "@/lib/api";

type Message = { role: "user" | "assistant"; content: string; sources?: Source[] };
type Source = { source: string; page: number; snippet: string };
type HistoryRow = { id: number; session_label: string; question: string; answer: string; created_at: string };
type Tab = "chat" | "quiz" | "notes" | "ocr";
type OcrImage = { width: number; height: number; ocr_text: string; vision_description: string };
type OcrPage = { page: number; has_native_text: boolean; native_text_preview: string; ocr_text: string; images_found: number; image_ocr_results: OcrImage[] };

// Styled markdown renderer
function MD({ children }: { children: string }) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
                h1: ({ children }) => <h1 className="text-xl font-bold text-white mt-4 mb-2 border-b border-gray-600 pb-1">{children}</h1>,
                h2: ({ children }) => <h2 className="text-lg font-semibold text-indigo-300 mt-4 mb-2">{children}</h2>,
                h3: ({ children }) => <h3 className="text-base font-semibold text-gray-200 mt-3 mb-1">{children}</h3>,
                p: ({ children }) => <p className="text-gray-100 mb-2 leading-relaxed">{children}</p>,
                ul: ({ children }) => <ul className="list-disc list-inside space-y-1 mb-2 text-gray-200 ml-2">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 mb-2 text-gray-200 ml-2">{children}</ol>,
                li: ({ children }) => <li className="text-gray-200 leading-relaxed">{children}</li>,
                strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
                code: ({ children }) => <code className="bg-gray-700 text-green-300 px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>,
                blockquote: ({ children }) => <blockquote className="border-l-4 border-indigo-500 pl-3 my-2 text-gray-300 italic">{children}</blockquote>,
                hr: () => <hr className="border-gray-600 my-3" />,
                table: ({ children }) => <div className="overflow-x-auto my-2"><table className="w-full text-sm border-collapse">{children}</table></div>,
                th: ({ children }) => <th className="border border-gray-600 px-3 py-1.5 bg-gray-700 text-gray-200 text-left font-medium">{children}</th>,
                td: ({ children }) => <td className="border border-gray-600 px-3 py-1.5 text-gray-300">{children}</td>,
            }}
        >
            {children}
        </ReactMarkdown>
    );
}

export default function ChatPage() {
    const router = useRouter();
    const [tab, setTab] = useState<Tab>("chat");
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [sessionLabel, setSessionLabel] = useState("");
    const [indexed, setIndexed] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState("");
    const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
    const [thinking, setThinking] = useState(false);
    const [history, setHistory] = useState<HistoryRow[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    const [error, setError] = useState("");
    const [quiz, setQuiz] = useState("");
    const [quizLoading, setQuizLoading] = useState(false);
    const [numQuestions, setNumQuestions] = useState(5);
    const [notes, setNotes] = useState("");
    const [notesLoading, setNotesLoading] = useState(false);
    // OCR state
    const [ocrFile, setOcrFile] = useState<File | null>(null);
    const [ocrLoading, setOcrLoading] = useState(false);
    const [ocrReport, setOcrReport] = useState<OcrPage[] | null>(null);
    const [ocrFilename, setOcrFilename] = useState("");
    const [explanations, setExplanations] = useState<Record<string, string>>({});
    const [explainingKey, setExplainingKey] = useState("");
    const [listening, setListening] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [voiceOutput, setVoiceOutput] = useState(false); // voice output toggle
    const [username, setUsername] = useState("");
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const storedFilesRef = useRef<File[]>([]);
    const recognitionRef = useRef<any>(null);
    const speechSessionIdRef = useRef(0);

    useEffect(() => {
        if (!localStorage.getItem("token")) { router.push("/"); return; }
        setUsername(localStorage.getItem("username") || "");
        apiHistory().then(setHistory).catch(() => setHistory([]));
    }, [router]);

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

    async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const newFiles = Array.from(e.target.files || []);
        if (!newFiles.length) return;

        // Merge new files with already uploaded ones (avoid duplicates by name)
        const existingNames = new Set(uploadedFiles);
        const uniqueNewFiles = newFiles.filter(f => !existingNames.has(f.name));
        const allFiles = [...(storedFilesRef.current || []), ...uniqueNewFiles];
        storedFilesRef.current = allFiles;

        if (allFiles.length === 0) {
            setError("All selected files are already indexed.");
            return;
        }

        setUploading(true); setError("");
        setUploadStatus("Reading PDFs...");
        const steps: [number, string][] = [
            [800, "Extracting text..."],
            [2500, "Creating embeddings (first run ~20s)..."],
            [8000, "Building knowledge base..."],
            [15000, "Almost done..."],
        ];
        const timers = steps.map(([d, m]) => setTimeout(() => setUploadStatus(m), d));
        try {
            await apiUpload(allFiles);
            timers.forEach(clearTimeout);
            const allNames = allFiles.map(f => f.name);
            const firstName = allNames[0].replace(".pdf", "");
            const now = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
            setSessionLabel(`${firstName.slice(0, 30)}${allNames.length > 1 ? ` +${allNames.length - 1} more` : ""} — ${now}`);
            setUploadedFiles(allNames);
            setUploadStatus(""); setIndexed(true);
            if (fileInputRef.current) fileInputRef.current.value = "";
        } catch (err: unknown) {
            timers.forEach(clearTimeout);
            setUploadStatus("");
            // Rollback stored files on failure
            storedFilesRef.current = storedFilesRef.current.filter(f => !uniqueNewFiles.includes(f));
            setError(err instanceof Error ? err.message : "Upload failed");
        } finally { setUploading(false); }
    }

    async function sendMessage(question: string, isVoice = false) {
        if (!question.trim()) return;
        setInput("");
        setMessages(m => [...m, { role: "user", content: question }]);
        setThinking(true); setError("");
        try {
            const data = await apiChat(question, sessionLabel, messages);
            const msg: Message = { role: "assistant", content: data.answer, sources: data.sources };
            setMessages(m => [...m, msg]);
            setHistory(h => [{ id: Date.now(), session_label: sessionLabel, question, answer: data.answer, created_at: new Date().toISOString() }, ...h]);
            if (isVoice && voiceOutput) speakText(data.answer);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Something went wrong");
        } finally { setThinking(false); }
    }

    function handleSend(e: React.FormEvent) {
        e.preventDefault();
        sendMessage(input);
    }

    function toggleVoice() {
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SR) { setError("Voice input not supported in this browser. Try Chrome."); return; }
        if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
        const rec = new SR();
        rec.lang = "en-US"; rec.interimResults = false;
        rec.onresult = (ev: any) => { sendMessage(ev.results[0][0].transcript, true); setListening(false); };
        rec.onerror = () => setListening(false);
        rec.onend = () => setListening(false);
        recognitionRef.current = rec;
        rec.start(); setListening(true);
    }

    function speakText(text: string) {
        if (!window.speechSynthesis) return;

        // Invalidate any ongoing speech session and cancel current TTS
        const currentSessionId = ++speechSessionIdRef.current;
        window.speechSynthesis.cancel();

        // Strip markdown symbols so they aren't read aloud
        const clean = text
            .replace(/#{1,6}\s/g, "")
            .replace(/\*\*/g, "").replace(/\*/g, "")
            .replace(/`/g, "").replace(/>\s/g, "")
            .replace(/[-•]\s/g, "")
            .replace(/\n{2,}/g, ". ")
            .replace(/\n/g, " ")
            .trim();

        // Split into sentences to avoid browser TTS cutoff on long text
        const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
        let i = 0;

        function speakNext() {
            if (currentSessionId !== speechSessionIdRef.current) return;
            if (i >= sentences.length) { setSpeaking(false); return; }
            const utt = new SpeechSynthesisUtterance(sentences[i].trim());
            utt.rate = 0.95;
            utt.onend = () => {
                if (currentSessionId !== speechSessionIdRef.current) return;
                i++;
                speakNext();
            };
            utt.onerror = () => {
                if (currentSessionId !== speechSessionIdRef.current) return;
                i++;
                speakNext();
            };
            window.speechSynthesis.speak(utt);
        }

        setSpeaking(true);
        speakNext();
    }

    function stopSpeaking() {
        speechSessionIdRef.current++;
        window.speechSynthesis?.cancel();
        setSpeaking(false);
    }

    async function handleGenerateQuiz() {
        setQuizLoading(true); setError("");
        try { const d = await apiQuiz(numQuestions); setQuiz(d.quiz); }
        catch (err: unknown) { setError(err instanceof Error ? err.message : "Quiz failed"); }
        finally { setQuizLoading(false); }
    }

    async function handleGenerateNotes() {
        setNotesLoading(true); setError("");
        try { const d = await apiNotes(); setNotes(d.notes); }
        catch (err: unknown) { setError(err instanceof Error ? err.message : "Notes failed"); }
        finally { setNotesLoading(false); }
    }

    function download(content: string, filename: string) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
        a.download = filename; a.click();
    }

    async function handleOcr() {
        if (!ocrFile) return;
        setOcrLoading(true); setError(""); setOcrReport(null); setExplanations({});
        try {
            const data = await apiOcr(ocrFile);
            setOcrReport(data.report);
            setOcrFilename(data.filename);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "OCR failed");
        } finally { setOcrLoading(false); }
    }

    async function handleExplain(key: string, text: string) {
        setExplainingKey(key);
        try {
            const data = await apiExplainDiagram(text);
            setExplanations(e => ({ ...e, [key]: data.explanation }));
        } catch (err: unknown) {
            setExplanations(e => ({ ...e, [key]: `Error: ${err instanceof Error ? err.message : "failed"}` }));
        } finally { setExplainingKey(""); }
    }

    async function handleClear() {
        await apiClearKB();
        storedFilesRef.current = [];
        setIndexed(false); setMessages([]); setSessionLabel("");
        setUploadedFiles([]); setQuiz(""); setNotes("");
    }

    async function handleRemoveFile(fileNameToRemove: string) {
        if (uploading) return;

        const remainingFiles = storedFilesRef.current.filter(f => f.name !== fileNameToRemove);
        storedFilesRef.current = remainingFiles;

        if (remainingFiles.length === 0) {
            await handleClear();
            return;
        }

        setUploading(true); setError("");
        setUploadStatus("Re-indexing remaining files...");
        try {
            await apiUpload(remainingFiles);
            const remainingNames = remainingFiles.map(f => f.name);
            const firstName = remainingNames[0].replace(".pdf", "");
            const now = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
            setSessionLabel(`${firstName.slice(0, 30)}${remainingNames.length > 1 ? ` +${remainingNames.length - 1} more` : ""} — ${now}`);
            setUploadedFiles(remainingNames);
            setUploadStatus("");
        } catch (err: unknown) {
            setUploadStatus("");
            setError(err instanceof Error ? err.message : "Failed to update index after file removal");
        } finally { setUploading(false); }
    }

    return (
        <div className="flex h-screen bg-gray-950 text-gray-100">
            {/* Sidebar */}
            <aside className="w-72 bg-gray-900 border-r border-gray-800 flex flex-col p-4 gap-4 overflow-y-auto shrink-0">
                <div>
                    <h2 className="text-lg font-bold">📚 PDF Bot</h2>
                    <p className="text-xs text-gray-400">👤 {username}</p>
                </div>

                <div className="space-y-2">
                    <label className={`block w-full text-center text-sm py-2 rounded-lg border border-dashed cursor-pointer transition-colors
                        ${indexed ? "border-green-500 text-green-400" : "border-gray-600 text-gray-400 hover:border-indigo-500 hover:text-indigo-400"}
                        ${uploading ? "cursor-not-allowed opacity-60" : ""}`}>
                        {uploading ? "⏳ Processing..." : indexed ? `✓ ${uploadedFiles.length} PDF${uploadedFiles.length > 1 ? "s" : ""} Indexed` : "Upload PDFs"}
                        <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
                    </label>

                    {uploading && uploadStatus && (
                        <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
                            <span className="text-xs animate-pulse">⚙️</span>
                            <span className="text-xs text-yellow-400">{uploadStatus}</span>
                        </div>
                    )}

                    {indexed && uploadedFiles.map((name, i) => (
                        <div key={i} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5 gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-green-400 text-xs shrink-0">📄</span>
                                <span className="text-xs text-gray-300 truncate" title={name}>{name}</span>
                            </div>
                            <button
                                onClick={() => handleRemoveFile(name)}
                                disabled={uploading}
                                className="text-gray-500 hover:text-red-400 text-xs px-1.5 py-0.5 hover:bg-gray-700 rounded transition-colors shrink-0 font-bold"
                                title="Remove document"
                            >
                                ✕
                            </button>
                        </div>
                    ))}

                    {sessionLabel && <p className="text-xs text-gray-500 truncate">📁 {sessionLabel}</p>}

                    {indexed && (
                        <button onClick={handleClear} className="w-full text-xs py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-500 transition-colors">
                            Clear Knowledge Base
                        </button>
                    )}
                </div>

                <div className="border-t border-gray-800 pt-3 flex-1 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-400">Chat History</span>
                        <div className="flex gap-2">
                            <button onClick={() => setShowHistory(s => !s)} className="text-xs text-indigo-400 hover:text-indigo-300">
                                {showHistory ? "Hide" : "Show"}
                            </button>
                            {history.length > 0 && (
                                <button onClick={() => download(history.map(r => `[${r.created_at}]\nQ: ${r.question}\nA: ${r.answer}\n${"─".repeat(40)}`).join("\n"), "history.txt")}
                                    className="text-xs text-gray-400 hover:text-white">⬇</button>
                            )}
                        </div>
                    </div>
                    {showHistory && (
                        <div className="overflow-y-auto space-y-2 max-h-48">
                            {history.length === 0 && <p className="text-xs text-gray-600">No history yet.</p>}
                            {history.map(r => (
                                <div key={r.id} className="bg-gray-800 rounded-lg p-2 text-xs">
                                    <p className="text-gray-400 truncate">{r.session_label || "General"}</p>
                                    <p className="text-gray-300 truncate">Q: {r.question}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <button onClick={() => router.push("/settings")}
                    className="w-full text-xs py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors">
                    ⚙️ Security Settings
                </button>
                <button onClick={() => { localStorage.clear(); router.push("/"); }}
                    className="w-full text-xs py-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors">
                    Logout
                </button>
                <button onClick={() => router.push("/resume")}
                    className="w-full text-xs py-2 rounded-lg bg-indigo-900 hover:bg-indigo-800 text-indigo-300 border border-indigo-700 transition-colors">
                    📋 Resume Analyzer
                </button>
            </aside>

            {/* Main */}
            <main className="flex-1 flex flex-col overflow-hidden">
                {/* Tabs */}
                <div className="flex items-center gap-1 p-3 border-b border-gray-800 bg-gray-900">
                    {(["chat", "quiz", "notes", "ocr"] as Tab[]).map(t => (
                        <button key={t} onClick={() => setTab(t)}
                            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === t ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}>
                            {t === "chat" ? "💬 Chat" : t === "quiz" ? "🧠 Quiz" : t === "notes" ? "📝 Notes" : "🔍 OCR"}
                        </button>
                    ))}
                    <div className="ml-auto flex items-center gap-2">
                        {/* Voice output toggle */}
                        <button
                            onClick={() => { setVoiceOutput(v => !v); if (speaking) stopSpeaking(); }}
                            title={voiceOutput ? "Voice output ON — click to turn off" : "Voice output OFF — click to turn on"}
                            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors
                                ${voiceOutput ? "bg-indigo-900 border-indigo-500 text-indigo-300" : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white"}`}>
                            {voiceOutput ? "🔊 Voice On" : "🔇 Voice Off"}
                        </button>
                        {speaking && (
                            <button onClick={stopSpeaking}
                                className="text-xs px-3 py-1.5 rounded-lg bg-red-900 text-red-300 animate-pulse border border-red-700">
                                ⏹ Stop
                            </button>
                        )}
                    </div>
                </div>

                {/* Chat */}
                {tab === "chat" && (
                    <>
                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            {messages.length === 0 && (
                                <div className="h-full flex items-center justify-center text-gray-600 text-sm">
                                    Upload PDFs to start chatting.
                                </div>
                            )}
                            {messages.map((m, i) => (
                                <div key={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                                    <div className={`max-w-2xl rounded-2xl px-4 py-3 text-sm
                                        ${m.role === "user" ? "bg-indigo-600 text-white whitespace-pre-wrap" : "bg-gray-800 text-gray-100"}`}>
                                        {m.role === "user" ? m.content : <MD>{m.content}</MD>}
                                    </div>
                                    {/* Per-message speak button for assistant */}
                                    {m.role === "assistant" && (
                                        <button onClick={() => speaking ? stopSpeaking() : speakText(m.content)}
                                            title={speaking ? "Stop speaking" : "Read aloud"}
                                            className="mt-1 text-xs text-gray-500 hover:text-indigo-400 transition-colors px-2 py-0.5 rounded">
                                            {speaking ? "⏹ Stop" : "🔊 Read aloud"}
                                        </button>
                                    )}
                                    {m.sources && m.sources.length > 0 && (
                                        <div className="mt-1 flex flex-wrap gap-1 max-w-2xl">
                                            {m.sources.map((s, si) => (
                                                <span key={si} title={s.snippet}
                                                    className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full cursor-help border border-gray-600">
                                                    📄 {s.source} p.{s.page}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {thinking && (
                                <div className="flex justify-start">
                                    <div className="bg-gray-800 rounded-2xl px-4 py-3 text-sm text-gray-400 animate-pulse">Thinking...</div>
                                </div>
                            )}
                            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
                            <div ref={bottomRef} />
                        </div>
                        <form onSubmit={handleSend} className="p-4 border-t border-gray-800 flex gap-2">
                            <input className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500"
                                placeholder={indexed ? "Ask something about your documents..." : "Upload PDFs first"}
                                value={input} onChange={e => setInput(e.target.value)} disabled={!indexed || thinking} />
                            <button type="button" onClick={toggleVoice} disabled={!indexed}
                                title="Voice input"
                                className={`px-4 py-3 rounded-xl text-sm transition-colors disabled:opacity-40
                                    ${listening ? "bg-red-600 text-white animate-pulse" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}>
                                🎤
                            </button>
                            <button type="submit" disabled={!indexed || !input.trim() || thinking}
                                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl px-5 py-3 text-sm font-medium transition-colors">
                                Send
                            </button>
                        </form>
                    </>
                )}

                {/* Quiz */}
                {tab === "quiz" && (
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                        <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-2">
                                <label className="text-sm text-gray-400">Questions:</label>
                                <select value={numQuestions} onChange={e => setNumQuestions(Number(e.target.value))}
                                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm">
                                    {[3, 5, 10, 15].map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </div>
                            <button onClick={handleGenerateQuiz} disabled={!indexed || quizLoading}
                                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                                {quizLoading ? "Generating..." : "🧠 Generate Quiz"}
                            </button>
                            {quiz && (
                                <button onClick={() => download(quiz, "quiz.txt")}
                                    className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm transition-colors">
                                    ⬇ Download
                                </button>
                            )}
                        </div>
                        {!indexed && <p className="text-gray-500 text-sm">Upload PDFs first.</p>}
                        {error && <p className="text-red-400 text-sm">{error}</p>}
                        {quiz && (
                            <div className="bg-gray-800 rounded-xl p-5 text-sm text-gray-100">
                                <MD>{quiz}</MD>
                            </div>
                        )}
                    </div>
                )}

                {/* Notes */}
                {tab === "notes" && (
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                        <div className="flex items-center gap-3">
                            <button onClick={handleGenerateNotes} disabled={!indexed || notesLoading}
                                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                                {notesLoading ? "Generating..." : "📝 Generate Notes"}
                            </button>
                            {notes && (
                                <button onClick={() => download(notes, "notes.txt")}
                                    className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm transition-colors">
                                    ⬇ Download
                                </button>
                            )}
                        </div>
                        {!indexed && <p className="text-gray-500 text-sm">Upload PDFs first.</p>}
                        {error && <p className="text-red-400 text-sm">{error}</p>}
                        {notes && (
                            <div className="bg-gray-800 rounded-xl p-5 text-sm text-gray-100">
                                <MD>{notes}</MD>
                            </div>
                        )}
                    </div>
                )}

                {/* OCR */}
                {tab === "ocr" && (
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                        <div className="bg-gray-900 rounded-xl border border-gray-700 p-4 space-y-3">
                            <h3 className="text-sm font-semibold text-gray-200">🔍 Image & OCR Extractor</h3>
                            <p className="text-xs text-gray-400">Upload any PDF — extracts text from scanned pages and embedded images using EasyOCR + Tesseract. Diagrams can be explained by AI.</p>
                            <div className="flex items-center gap-3 flex-wrap">
                                <label className="flex items-center gap-2 bg-gray-800 border border-gray-700 hover:border-indigo-500 rounded-lg px-4 py-2 text-sm cursor-pointer transition-colors">
                                    📎 {ocrFile ? ocrFile.name : "Choose PDF"}
                                    <input type="file" accept=".pdf" className="hidden"
                                        onChange={e => { setOcrFile(e.target.files?.[0] || null); setOcrReport(null); }} />
                                </label>
                                <button onClick={handleOcr} disabled={!ocrFile || ocrLoading}
                                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                                    {ocrLoading ? "⏳ Scanning..." : "🔍 Run OCR"}
                                </button>
                            </div>
                        </div>

                        {error && <p className="text-red-400 text-sm">{error}</p>}

                        {ocrReport && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <h3 className="text-sm font-semibold text-gray-200">📄 {ocrFilename} — {ocrReport.length} pages</h3>
                                    <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">
                                        {ocrReport.filter(p => !p.has_native_text).length} scanned pages detected
                                    </span>
                                    <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">
                                        {ocrReport.reduce((a, p) => a + p.images_found, 0)} images found
                                    </span>
                                </div>

                                {ocrReport.map(page => (
                                    <div key={page.page} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                                        <div className="flex items-center justify-between px-4 py-2 bg-gray-750 border-b border-gray-700">
                                            <span className="text-sm font-medium text-gray-200">Page {page.page}</span>
                                            <div className="flex gap-2">
                                                {page.has_native_text
                                                    ? <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">✓ Native text</span>
                                                    : <span className="text-xs bg-yellow-900 text-yellow-300 px-2 py-0.5 rounded-full">⚠ Scanned — OCR applied</span>
                                                }
                                                {page.images_found > 0 && (
                                                    <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">🖼 {page.images_found} image{page.images_found > 1 ? "s" : ""}</span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="p-4 space-y-3">
                                            {/* Native or OCR'd page text */}
                                            {(page.native_text_preview || page.ocr_text) && (
                                                <div>
                                                    <p className="text-xs text-gray-400 mb-1">{page.has_native_text ? "Text preview:" : "OCR extracted text:"}</p>
                                                    <p className="text-xs text-gray-300 bg-gray-900 rounded-lg p-3 font-mono leading-relaxed">
                                                        {page.has_native_text ? page.native_text_preview : page.ocr_text}
                                                        {(page.native_text_preview.length >= 300 || page.ocr_text.length >= 500) && <span className="text-gray-500"> ...</span>}
                                                    </p>
                                                </div>
                                            )}

                                            {/* Per-image OCR results */}
                                            {page.image_ocr_results.map((img, ii) => {
                                                const key = `p${page.page}-i${ii}`;
                                                return (
                                                    <div key={key} className="border border-gray-700 rounded-lg p-3 space-y-2">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-xs text-gray-400">🖼 Image {ii + 1} — {img.width}×{img.height}px</span>
                                                            {img.ocr_text && (
                                                                <button
                                                                    onClick={() => handleExplain(key, img.ocr_text)}
                                                                    disabled={explainingKey === key}
                                                                    className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 px-3 py-1 rounded-lg transition-colors">
                                                                    {explainingKey === key ? "⏳ Explaining..." : "✨ Explain with AI"}
                                                                </button>
                                                            )}
                                                        </div>
                                                        {img.ocr_text ? (
                                                            <p className="text-xs text-gray-300 bg-gray-900 rounded p-2 font-mono">{img.ocr_text}</p>
                                                        ) : img.vision_description ? (
                                                            <div className="bg-indigo-950 border border-indigo-800 rounded-lg p-3">
                                                                <p className="text-xs text-indigo-300 font-medium mb-1">🤖 AI Vision Description:</p>
                                                                <div className="text-xs text-gray-200"><MD>{img.vision_description}</MD></div>
                                                            </div>
                                                        ) : (
                                                            <p className="text-xs text-gray-500 italic">No text detected in this image</p>
                                                        )}
                                                        {explanations[key] && (
                                                            <div className="bg-indigo-950 border border-indigo-800 rounded-lg p-3">
                                                                <p className="text-xs text-indigo-300 font-medium mb-1">✨ AI Explanation:</p>
                                                                <div className="text-xs text-gray-200">
                                                                    <MD>{explanations[key]}</MD>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
