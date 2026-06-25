"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiAdminStats, apiAdminUsers, apiAdminChats, apiDeleteUser, downloadAdminCsv } from "@/lib/api";

type Stats = { total_users: number; total_chats: number; chats_today: number };
type User = { id: number; username: string; role: string; created_at: string };
type Chat = { id: number; username: string; session_label: string; question: string; answer: string; created_at: string };

export default function AdminPage() {
    const router = useRouter();
    const [tab, setTab] = useState<"users" | "chats" | "report">("users");
    const [stats, setStats] = useState<Stats | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [chats, setChats] = useState<Chat[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const role = localStorage.getItem("role");
        if (!localStorage.getItem("token") || role !== "admin") { router.push("/"); return; }
        Promise.all([apiAdminStats(), apiAdminUsers(), apiAdminChats()]).then(([s, u, c]) => {
            setStats(s); setUsers(u); setChats(c); setLoading(false);
        });
    }, [router]);

    async function handleDelete(userId: number, username: string) {
        if (!confirm(`Delete user "${username}"? This also deletes their chats.`)) return;
        await apiDeleteUser(userId);
        setUsers(u => u.filter(x => x.id !== userId));
        setStats(s => s ? { ...s, total_users: s.total_users - 1 } : s);
    }

    function downloadCSV() {
        downloadAdminCsv().catch(e => alert(e.message));
    }

    function downloadChatsText() {
        const text = chats.map(c =>
            `[${c.created_at}] User: ${c.username} | Session: ${c.session_label || "General"}\nQ: ${c.question}\nA: ${c.answer}\n${"-".repeat(60)}`
        ).join("\n");
        const blob = new Blob([text], { type: "text/plain" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
        a.download = "all_chats.txt"; a.click();
    }

    function logout() { localStorage.clear(); router.push("/"); }

    if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;

    return (
        <div className="min-h-screen">
            {/* Header */}
            <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
                <h1 className="text-xl font-bold">🛡️ Admin Dashboard</h1>
                <button onClick={logout} className="text-sm text-gray-400 hover:text-white transition-colors">Logout</button>
            </header>

            <div className="max-w-6xl mx-auto p-6 space-y-6">
                {/* Stats */}
                {stats && (
                    <div className="grid grid-cols-3 gap-4">
                        {[["Total Users", stats.total_users], ["Total Chats", stats.total_chats], ["Chats Today", stats.chats_today]].map(([label, val]) => (
                            <div key={label} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                                <p className="text-gray-400 text-sm">{label}</p>
                                <p className="text-3xl font-bold mt-1">{val}</p>
                            </div>
                        ))}
                    </div>
                )}

                {/* Tabs */}
                <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800 w-fit">
                    {(["users", "chats", "report"] as const).map(t => (
                        <button key={t} onClick={() => setTab(t)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${tab === t ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}>
                            {t === "users" ? "👥 Users" : t === "chats" ? "💬 Chats" : "📊 Report"}
                        </button>
                    ))}
                </div>

                {/* Users Tab */}
                {tab === "users" && (
                    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-800 text-gray-400">
                                <tr>{["ID", "Username", "Role", "Registered", "Action"].map(h => (
                                    <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                                ))}</tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                                {users.map(u => (
                                    <tr key={u.id} className="hover:bg-gray-800/50">
                                        <td className="px-4 py-3 text-gray-400">{u.id}</td>
                                        <td className="px-4 py-3 font-medium">{u.username}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-0.5 rounded-full text-xs ${u.role === "admin" ? "bg-indigo-900 text-indigo-300" : "bg-gray-800 text-gray-300"}`}>
                                                {u.role}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-400 text-xs">{u.created_at}</td>
                                        <td className="px-4 py-3">
                                            {u.role !== "admin" && (
                                                <button onClick={() => handleDelete(u.id, u.username)}
                                                    className="text-xs text-red-400 hover:text-red-300 transition-colors">Delete</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Chats Tab */}
                {tab === "chats" && (
                    <div className="space-y-3">
                        <div className="flex justify-end">
                            <button onClick={downloadChatsText} className="text-sm bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition-colors">
                                ⬇ Download .txt
                            </button>
                        </div>
                        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-800 text-gray-400">
                                    <tr>{["User", "Session", "Question", "Answer", "Date"].map(h => (
                                        <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                                    ))}</tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800">
                                    {chats.map(c => (
                                        <tr key={c.id} className="hover:bg-gray-800/50">
                                            <td className="px-4 py-3 font-medium">{c.username}</td>
                                            <td className="px-4 py-3 text-gray-400 text-xs max-w-24 truncate">{c.session_label || "General"}</td>
                                            <td className="px-4 py-3 max-w-48 truncate text-gray-300">{c.question}</td>
                                            <td className="px-4 py-3 max-w-48 truncate text-gray-400">{c.answer}</td>
                                            <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{c.created_at}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Report Tab */}
                {tab === "report" && (
                    <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
                        <h2 className="font-semibold text-lg">Download Report</h2>
                        <p className="text-gray-400 text-sm">Full report including stats, all users, and complete chat log.</p>
                        <div className="flex gap-3">
                            <button onClick={downloadCSV}
                                className="bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
                                ⬇ Download CSV Report
                            </button>
                            <button onClick={downloadChatsText}
                                className="bg-gray-800 hover:bg-gray-700 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
                                ⬇ Download Chats .txt
                            </button>
                        </div>
                        {stats && (
                            <div className="mt-4 bg-gray-800 rounded-lg p-4 text-sm space-y-1 text-gray-300">
                                <p>Total Users: <span className="text-white font-medium">{stats.total_users}</span></p>
                                <p>Total Chats: <span className="text-white font-medium">{stats.total_chats}</span></p>
                                <p>Chats Today: <span className="text-white font-medium">{stats.chats_today}</span></p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
