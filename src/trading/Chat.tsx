import { useCallback, useRef, useState } from "react";
import { authedFetch } from "./auth";

/* ─── Panneau assistant flottant (Phase 5) ─────────────────────────────────
 * Appelle /api/chat (protégé par le token du dashboard) et affiche les
 * réponses de l'IA, nourries par le journal réel. */

interface Msg { role: "user" | "assistant"; content: string; }
const C = { panel: "#111B2E", soft: "#16233B", border: "#1F3050", text: "#E6EDF7", mid: "#9FB2CC", blue: "#4D9FFF", amber: "#F5B445" };

export default function Chat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || loading) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next); setInput(""); setLoading(true); setErr("");
    try {
      const res = await authedFetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (res.status === 401) {
        setErr("Déverrouille le dashboard (token) dans « Suivi des positions ».");
        setLoading(false); return;
      }
      const data = await res.json();
      const text = data?.content?.[0]?.text ?? data?.error ?? "Pas de réponse.";
      setMsgs([...next, { role: "assistant", content: typeof text === "string" ? text : JSON.stringify(text) }]);
    } catch {
      setErr("Erreur réseau.");
    }
    setLoading(false);
    setTimeout(() => boxRef.current?.scrollTo(0, 1e9), 50);
  }, [input, loading, msgs]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        style={{ position: "fixed", right: 18, bottom: 18, zIndex: 50, background: C.blue, color: "#04101F", border: "none", borderRadius: 999, padding: "12px 18px", fontWeight: 700, cursor: "pointer", boxShadow: "0 6px 20px rgba(0,0,0,.4)" }}>
        💬 Assistant
      </button>
    );
  }

  return (
    <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 50, width: "min(380px,92vw)", height: "min(520px,80vh)", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, display: "flex", flexDirection: "column", boxShadow: "0 10px 30px rgba(0,0,0,.5)" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${C.border}` }}>
        <strong style={{ color: C.text, fontSize: 14 }}>Assistant trading</strong>
        <button onClick={() => setOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", color: C.mid, fontSize: 18, cursor: "pointer" }}>×</button>
      </div>
      <div ref={boxRef} style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {msgs.length === 0 && (
          <div style={{ color: C.mid, fontSize: 13, lineHeight: 1.6 }}>
            Pose une question : « Meilleurs setups du jour ? », « Pourquoi cet achat ? », « Analyse les derniers ordres ».
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%", background: m.role === "user" ? C.blue : C.soft, color: m.role === "user" ? "#04101F" : C.text, padding: "8px 12px", borderRadius: 12, fontSize: 13, whiteSpace: "pre-wrap" }}>
            {m.content}
          </div>
        ))}
        {loading && <div style={{ color: C.mid, fontSize: 13 }}>…</div>}
        {err && <div style={{ color: C.amber, fontSize: 12.5 }}>{err}</div>}
      </div>
      <div style={{ display: "flex", gap: 8, padding: 10, borderTop: `1px solid ${C.border}` }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="Votre question…"
          style={{ flex: 1, background: C.soft, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 13 }} />
        <button onClick={send} disabled={loading} style={{ background: C.blue, color: "#04101F", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer" }}>→</button>
      </div>
    </div>
  );
}
