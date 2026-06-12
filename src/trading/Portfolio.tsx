import React, { useCallback, useEffect, useState } from "react";

/* ─── Suivi du compte courtier (Alpaca) via /api/positions ───────────────── */

const C = {
  panel: "#111B2E", panelSoft: "#16233B", border: "#1F3050",
  text: "#E6EDF7", textMid: "#9FB2CC", textDim: "#64789A",
  green: "#22C55E", greenBg: "#0E2A1C", red: "#EF4444", redBg: "#2A1214",
  amber: "#F5B445", amberBg: "#2A2110", blue: "#4D9FFF",
};

interface PortfolioData {
  configured: boolean;
  live: boolean;
  autotrade: boolean;
  emailConfigured: boolean;
  error?: string;
  account?: { equity: number; cash: number; buyingPower: number; status: string };
  positions?: Array<{
    symbol: string; qty: number; avgEntry: number; current: number;
    marketValue: number; pnl: number; pnlPct: number;
  }>;
  orders?: Array<{
    symbol: string; side: string; qty: number; type: string;
    status: string; submittedAt: string; fillPrice: number | null;
  }>;
}

const fmt$ = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const badge = (label: string, fg: string, bg: string) => (
  <span style={{ background: bg, color: fg, padding: "3px 10px", borderRadius: 999, fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>
    {label}
  </span>
);

export default function Portfolio() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/positions");
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) throw new Error("API unavailable");
      setData(await res.json());
      setUnavailable(false);
    } catch {
      setUnavailable(true); // dev local sans fonctions Vercel, ou réseau coupé
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const cellH: React.CSSProperties = { padding: "10px 14px", borderBottom: `1px solid ${C.border}`, fontWeight: 600, whiteSpace: "nowrap", textAlign: "left" };
  const cell: React.CSSProperties = { padding: "10px 14px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 style={{ fontSize: 17, margin: 0 }}>📒 Position tracking (broker)</h2>
        {data?.configured && (
          <>
            {data.live
              ? badge("LIVE MONEY", C.red, C.redBg)
              : badge("PAPER — simulated", C.green, C.greenBg)}
            {data.autotrade
              ? badge("🤖 Auto-trading ON", C.amber, C.amberBg)
              : badge("Auto-trading OFF", C.textDim, C.panelSoft)}
            {data.emailConfigured
              ? badge("✉️ Email alerts ON", C.blue, C.panelSoft)
              : badge("✉️ Email not configured", C.textDim, C.panelSoft)}
          </>
        )}
        <button
          onClick={load} disabled={loading}
          style={{ marginLeft: "auto", padding: "6px 14px", background: C.panelSoft, color: C.textMid, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, cursor: loading ? "wait" : "pointer" }}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {unavailable && (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, fontSize: 13, color: C.textMid, lineHeight: 1.6 }}>
          Broker tracking is only available once the app is deployed on Vercel (<code>/api</code>).
          Locally, only the signals work.
        </div>
      )}

      {data && !data.configured && (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, fontSize: 13, color: C.textMid, lineHeight: 1.7 }}>
          <strong style={{ color: C.text }}>Connect an Alpaca account for live tracking and automated trading.</strong>
          <br />
          1. Create a free account at <span style={{ color: C.blue }}>alpaca.markets</span> and copy your <em>paper trading</em> API keys.
          <br />
          2. In Vercel → Settings → Environment Variables, add <code>ALPACA_KEY_ID</code> et <code>ALPACA_SECRET_KEY</code>.
          <br />
          3. For automatic signal execution, add <code>AUTOTRADE=true</code>. The bot stays on simulated money as long as <code>ALPACA_LIVE=true</code> is not set.
          <br />
          4. For email alerts: <code>RESEND_API_KEY</code> (resend.com key) + <code>ALERT_EMAIL</code> (your address).
        </div>
      )}

      {data?.error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.red}40`, borderRadius: 12, padding: 14, fontSize: 13, color: C.red, marginBottom: 12 }}>
          Broker error: {data.error}
        </div>
      )}

      {data?.account && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 12 }}>
          {[
            ["Account value", `${fmt$(data.account.equity)} $`],
            ["Cash", `${fmt$(data.account.cash)} $`],
            ["Buying power", `${fmt$(data.account.buyingPower)} $`],
            ["Open positions", String(data.positions?.length ?? 0)],
          ].map(([label, value]) => (
            <div key={label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 12, color: C.textDim }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {data?.positions && data.positions.length > 0 && (
        <div style={{ overflowX: "auto", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 600 }}>
            <thead>
              <tr style={{ color: C.textDim }}>
                {["Asset", "Quantity", "Entry price", "Current price", "Value", "Unrealized P&L"].map((h) => (
                  <th key={h} style={cellH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.positions.map((p) => (
                <tr key={p.symbol}>
                  <td style={{ ...cell, fontWeight: 700 }}>{p.symbol}</td>
                  <td style={cell}>{p.qty}</td>
                  <td style={cell}>{fmt$(p.avgEntry)} $</td>
                  <td style={cell}>{fmt$(p.current)} $</td>
                  <td style={cell}>{fmt$(p.marketValue)} $</td>
                  <td style={{ ...cell, color: p.pnl >= 0 ? C.green : C.red, fontWeight: 600 }}>
                    {p.pnl >= 0 ? "+" : ""}{fmt$(p.pnl)} $ ({p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(2)} %)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.configured && data.positions?.length === 0 && !data.error && (
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 12 }}>
          No open positions at the broker right now.
        </div>
      )}

      {data?.orders && data.orders.length > 0 && (
        <details style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", fontSize: 13, color: C.textMid }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, color: C.text }}>
            Recent orders ({data.orders.length})
          </summary>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8 }}>
            <tbody>
              {data.orders.map((o, i) => (
                <tr key={i}>
                  <td style={cell}>{new Date(o.submittedAt).toLocaleDateString("en-US")}</td>
                  <td style={{ ...cell, color: o.side === "buy" ? C.green : C.red, fontWeight: 600 }}>
                    {o.side === "buy" ? "BUY" : "SELL"}
                  </td>
                  <td style={{ ...cell, fontWeight: 600 }}>{o.symbol}</td>
                  <td style={cell}>{o.qty} × {o.fillPrice ? `${fmt$(o.fillPrice)} $` : "—"}</td>
                  <td style={cell}>{o.type}</td>
                  <td style={{ ...cell, color: C.textDim }}>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
