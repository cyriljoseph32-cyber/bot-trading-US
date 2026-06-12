import React, { useCallback, useEffect, useMemo, useState } from "react";
import Portfolio from "./Portfolio";
import { fetchCandles, INDEX_ETFS, NAMES, WATCHLIST } from "./data";
import {
  PARAMS,
  positionSize,
  runStrategy,
  type Action,
  type StrategyResult,
} from "./strategy";

/* ─── Design tokens (thème sombre "salle de marché") ─────────────────────── */
const C = {
  bg: "#0B1220", panel: "#111B2E", panelSoft: "#16233B", border: "#1F3050",
  text: "#E6EDF7", textMid: "#9FB2CC", textDim: "#64789A",
  green: "#22C55E", greenBg: "#0E2A1C", red: "#EF4444", redBg: "#2A1214",
  amber: "#F5B445", amberBg: "#2A2110", blue: "#4D9FFF",
};

const ACTION_STYLE: Record<Action, { label: string; fg: string; bg: string; icon: string }> = {
  ACHETER: { label: "ACHETER", fg: C.green, bg: C.greenBg, icon: "🟢" },
  VENDRE: { label: "SORTIR", fg: C.red, bg: C.redBg, icon: "🔴" },
  CONSERVER: { label: "CONSERVER", fg: C.amber, bg: C.amberBg, icon: "🟡" },
  ATTENDRE: { label: "ATTENDRE", fg: C.textDim, bg: C.panelSoft, icon: "⚪" },
};

const ACTION_ORDER: Record<Action, number> = {
  ACHETER: 0, VENDRE: 1, CONSERVER: 2, ATTENDRE: 3,
};

interface Row {
  symbol: string;
  result: StrategyResult;
}

const fmt$ = (v: number) =>
  v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v: number, signed = true) =>
  `${signed && v > 0 ? "+" : ""}${v.toFixed(2)} %`;

export default function TradingApp() {
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [capital, setCapital] = useState<number>(() => {
    const saved = localStorage.getItem("bot_capital");
    return saved ? Number(saved) : 10000;
  });
  const [riskPct, setRiskPct] = useState<number>(() => {
    const saved = localStorage.getItem("bot_risk");
    return saved ? Number(saved) : 1;
  });

  useEffect(() => localStorage.setItem("bot_capital", String(capital)), [capital]);
  useEffect(() => localStorage.setItem("bot_risk", String(riskPct)), [riskPct]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const nextRows: Row[] = [];
    const nextErrors: string[] = [];
    await Promise.all(
      WATCHLIST.map(async (symbol) => {
        try {
          const candles = await fetchCandles(symbol);
          const result = runStrategy(candles);
          if (result) nextRows.push({ symbol, result });
          else nextErrors.push(`${symbol} : historique insuffisant`);
        } catch (e) {
          nextErrors.push(e instanceof Error ? e.message : `Erreur ${symbol}`);
        }
      })
    );
    nextRows.sort(
      (a, b) =>
        ACTION_ORDER[a.result.action] - ACTION_ORDER[b.result.action] ||
        a.symbol.localeCompare(b.symbol)
    );
    setRows(nextRows);
    setErrors(nextErrors);
    setUpdatedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0); // premier chargement (hors corps de l'effet)
    const id = setInterval(refresh, 5 * 60 * 1000); // rafraîchit toutes les 5 min
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  const indexRows = useMemo(
    () => INDEX_ETFS.map((s) => rows.find((r) => r.symbol === s)).filter(Boolean) as Row[],
    [rows]
  );
  const buys = rows.filter((r) => r.result.action === "ACHETER").length;
  const sells = rows.filter((r) => r.result.action === "VENDRE").length;
  const bullish = rows.filter((r) => r.result.trend === "haussier").length;

  return (
    <div style={{ minHeight: "100vh", background: `radial-gradient(1200px 600px at 80% -10%, #16335E 0%, transparent 60%), radial-gradient(900px 500px at 0% 0%, #11324A 0%, transparent 55%), ${C.bg}`, color: C.text, fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "0 16px 48px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>

        {/* ── En-tête ── */}
        <header style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, padding: "18px 16px", margin: "0 -16px 20px", background: "rgba(11,18,32,0.72)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ flex: "1 1 320px" }}>
            <h1 style={{ margin: 0, fontSize: "clamp(22px, 3.2vw, 32px)", fontWeight: 800, background: `linear-gradient(90deg, ${C.text}, ${C.blue})`, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: -0.5 }}>📈 Signal Bot — Actifs US</h1>
            <div style={{ color: C.textMid, fontSize: 13, marginTop: 4 }}>
              Stratégie retour à la moyenne RSI(2) · bougies journalières · long uniquement
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: C.textMid }}>
              Capital ($)
              <input
                type="number" min={100} step={500} value={capital}
                onChange={(e) => setCapital(Math.max(0, Number(e.target.value)))}
                style={{ display: "block", marginTop: 4, width: 110, padding: "8px 10px", background: C.panelSoft, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14 }}
              />
            </label>
            <label style={{ fontSize: 12, color: C.textMid }}>
              Risque / trade
              <select
                value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))}
                style={{ display: "block", marginTop: 4, padding: "8px 10px", background: C.panelSoft, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14 }}
              >
                {[0.5, 1, 2].map((r) => <option key={r} value={r}>{r} %</option>)}
              </select>
            </label>
            <button
              onClick={refresh} disabled={loading}
              style={{ padding: "9px 18px", background: loading ? C.panelSoft : C.blue, color: loading ? C.textDim : "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? "wait" : "pointer" }}
            >
              {loading ? "Chargement…" : "🔄 Actualiser"}
            </button>
          </div>
        </header>

        {updatedAt && (
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 12 }}>
            Dernière mise à jour : {updatedAt.toLocaleTimeString("fr-FR")} · actualisation auto toutes les 5 min · données Yahoo Finance (clôtures journalières, différé possible)
          </div>
        )}

        {/* ── Bandeau KPI ── */}
        {rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 18 }}>
            {[
              { l: "Actifs suivis", v: String(rows.length), c: C.text },
              { l: "Tendance haussière", v: `${bullish}/${rows.length}`, c: bullish >= rows.length / 2 ? C.green : C.amber },
              { l: "Signaux d'achat", v: String(buys), c: C.green },
              { l: "Signaux de sortie", v: String(sells), c: C.red },
            ].map((k) => (
              <div key={k.l} style={{ background: "linear-gradient(160deg, #16233B, #111B2E)", border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: C.textDim }}>{k.l}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: k.c, marginTop: 2 }}>{k.v}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Avertissement ── */}
        <div style={{ background: C.amberBg, border: `1px solid ${C.amber}40`, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: C.textMid, marginBottom: 20 }}>
          ⚠️ <strong style={{ color: C.amber }}>Outil d'aide à la décision, pas un conseil financier.</strong>{" "}
          La colonne « Réussite hist. » mesure le taux réel de trades gagnants de cette stratégie sur les 2 dernières années — viser ~70 % est l'objectif de la méthode, mais les performances passées ne garantissent rien. Ne risquez que de l'argent que vous pouvez perdre.
        </div>

        {/* ── Lecture du marché ── */}
        <h2 style={{ fontSize: 17, margin: "0 0 10px" }}>🌎 Lecture du marché US</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 8 }}>
          {indexRows.map(({ symbol, result }) => {
            const dayPct = result.prevClose ? (result.lastClose / result.prevClose - 1) * 100 : 0;
            const up = result.trend === "haussier";
            return (
              <div key={symbol} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <strong style={{ fontSize: 15 }}>{symbol}</strong>
                  <span style={{ fontSize: 12, color: C.textDim }}>{NAMES[symbol]}</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 2px" }}>{fmt$(result.lastClose)} $</div>
                <div style={{ fontSize: 13, color: dayPct >= 0 ? C.green : C.red }}>{fmtPct(dayPct)} aujourd'hui</div>
                <div style={{ fontSize: 12, color: C.textMid, marginTop: 8 }}>
                  Tendance :{" "}
                  <span style={{ color: up ? C.green : C.red, fontWeight: 600 }}>
                    {up ? "▲ haussière" : "▼ baissière"}
                  </span>{" "}
                  (vs MM200) · RSI14 {result.rsi14?.toFixed(0) ?? "–"}
                </div>
              </div>
            );
          })}
          {!indexRows.length && !loading && (
            <div style={{ color: C.textDim, fontSize: 13 }}>Aucune donnée indice disponible.</div>
          )}
        </div>
        {rows.length > 0 && (
          <div style={{ fontSize: 13, color: C.textMid, margin: "4px 0 24px" }}>
            {bullish}/{rows.length} actifs en tendance haussière ·{" "}
            <span style={{ color: C.green }}>{buys} signal{buys > 1 ? "s" : ""} d'achat</span> ·{" "}
            <span style={{ color: C.red }}>{sells} signal{sells > 1 ? "s" : ""} de sortie</span>
          </div>
        )}

        {/* ── Tableau des signaux ── */}
        <h2 style={{ fontSize: 17, margin: "0 0 10px" }}>🎯 Signaux du jour & plan d'action</h2>
        <div style={{ overflowX: "auto", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 880 }}>
            <thead>
              <tr style={{ color: C.textDim, textAlign: "left" }}>
                {["Actif", "Cours", "Var. jour", "RSI(2)", "Tendance", "Signal", "Plan d'action", "Réussite hist."].map((h) => (
                  <th key={h} style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ symbol, result: r }) => {
                const a = ACTION_STYLE[r.action];
                const dayPct = r.prevClose ? (r.lastClose / r.prevClose - 1) * 100 : 0;
                const wr = r.winRate;
                const wrColor = wr === null ? C.textDim : wr >= 0.7 ? C.green : wr >= 0.6 ? C.amber : C.red;

                let plan: React.ReactNode = <span style={{ color: C.textDim }}>Aucune action — attendre un repli en tendance haussière.</span>;
                if (r.action === "ACHETER" && r.entryPlan) {
                  const qty = positionSize(capital, riskPct, r.entryPlan.entry, r.entryPlan.stop);
                  plan = (
                    <span>
                      Acheter <strong>{qty || "—"}</strong> action{qty > 1 ? "s" : ""} ≈ <strong>{fmt$(r.entryPlan.entry)} $</strong>
                      <br />
                      Stop : <strong style={{ color: C.red }}>{fmt$(r.entryPlan.stop)} $</strong> · Sortie : clôture &gt; MM5 (ou 10 séances max)
                    </span>
                  );
                } else if (r.action === "VENDRE") {
                  plan = (
                    <span>
                      Clôturer la position au cours actuel —{" "}
                      {r.exitReason === "stop" ? "stop touché 🔻" : r.exitReason === "temps" ? "délai de 10 séances atteint" : "objectif atteint (clôture > MM5) ✅"}
                    </span>
                  );
                } else if (r.action === "CONSERVER" && r.open) {
                  const pnl = (r.lastClose / r.open.entryPrice - 1) * 100;
                  plan = (
                    <span>
                      En position depuis {r.open.daysHeld} séance{r.open.daysHeld > 1 ? "s" : ""} (entrée {fmt$(r.open.entryPrice)} $,{" "}
                      <span style={{ color: pnl >= 0 ? C.green : C.red }}>{fmtPct(pnl)}</span>)
                      <br />
                      Garder le stop à <strong style={{ color: C.red }}>{fmt$(r.open.stop)} $</strong> · sortir si clôture &gt; MM5
                    </span>
                  );
                }

                return (
                  <tr key={symbol} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <strong>{symbol}</strong>
                      <div style={{ fontSize: 11, color: C.textDim }}>{NAMES[symbol]}</div>
                    </td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{fmt$(r.lastClose)} $</td>
                    <td style={{ padding: "12px 14px", color: dayPct >= 0 ? C.green : C.red, whiteSpace: "nowrap" }}>{fmtPct(dayPct)}</td>
                    <td style={{ padding: "12px 14px", color: (r.rsi2 ?? 50) < PARAMS.rsiEntry ? C.green : C.textMid }}>
                      {r.rsi2?.toFixed(0) ?? "–"}
                    </td>
                    <td style={{ padding: "12px 14px", color: r.trend === "haussier" ? C.green : C.red, whiteSpace: "nowrap" }}>
                      {r.trend === "haussier" ? "▲ haussière" : "▼ baissière"}
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ background: a.bg, color: a.fg, padding: "4px 10px", borderRadius: 999, fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>
                        {a.icon} {a.label}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", color: C.textMid, lineHeight: 1.5, minWidth: 240 }}>{plan}</td>
                    <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                      <strong style={{ color: wrColor }}>{wr === null ? "–" : `${(wr * 100).toFixed(0)} %`}</strong>
                      <div style={{ fontSize: 11, color: C.textDim }}>
                        {r.trades.length} trades / 2 ans · {fmtPct(r.totalPnlPct)} cumulés
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: "center", color: C.textDim }}>
                    {loading ? "Analyse du marché en cours…" : "Aucune donnée. Cliquez sur Actualiser."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {errors.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: C.red }}>
            Erreurs : {errors.join(" · ")}
          </div>
        )}

        {/* ── Suivi courtier ── */}
        <Portfolio />

        {/* ── Méthode ── */}
        <div style={{ marginTop: 28, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, fontSize: 13, color: C.textMid, lineHeight: 1.7 }}>
          <h3 style={{ margin: "0 0 8px", color: C.text, fontSize: 15 }}>📚 Comment fonctionne le bot</h3>
          <strong style={{ color: C.text }}>Entrée (🟢 ACHETER)</strong> : l'actif est en tendance haussière de fond (cours &gt; moyenne mobile 200 jours) <em>et</em> vient de subir un repli excessif à court terme (RSI 2 jours &lt; 10). Statistiquement, ces replis en tendance haussière rebondissent dans la majorité des cas — c'est ce qui permet de viser ~70 % de trades gagnants.
          <br />
          <strong style={{ color: C.text }}>Sortie (🔴 SORTIR)</strong> : dès que la clôture repasse au-dessus de la moyenne mobile 5 jours (prise de profit), si le stop de protection est touché (entrée − 2,5 × ATR14), ou après 10 séances sans rebond.
          <br />
          <strong style={{ color: C.text }}>Gestion du risque</strong> : la taille de position est calculée pour que le stop ne coûte que {riskPct} % de votre capital ({fmt$((capital * riskPct) / 100)} $ par trade). C'est ce qui protège le compte : les gains sont fréquents et petits, les pertes rares sont coupées.
          <br />
          <strong style={{ color: C.text }}>Discipline</strong> : prenez TOUS les signaux ou aucun — le taux de réussite n'a de sens que sur un grand nombre de trades. Vérifiez les signaux après la clôture de Wall Street (22h00, heure de Paris).
        </div>
      </div>
    </div>
  );
}
