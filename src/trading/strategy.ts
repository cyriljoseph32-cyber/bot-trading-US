import { atr, rsi, sma } from "./indicators";

/* ─── Stratégie : retour à la moyenne RSI(2) en tendance haussière ────────
 *
 * Règles (long uniquement, bougies journalières) :
 *  ENTRÉE  : clôture > MM200 (tendance de fond haussière)
 *            ET RSI(2) < 10 (repli excessif à court terme)
 *  SORTIE  : clôture > MM5  → prise de profit (cas le plus fréquent)
 *            clôture ≤ stop (entrée − 2.5 × ATR14) → stop de protection
 *            10 séances sans rebond → sortie temps
 *
 * Cette famille de stratégies vise un taux de réussite historique élevé
 * (~65–75 % sur actifs US liquides) : beaucoup de petits gains, quelques
 * pertes plus grosses coupées par le stop. Le backtest ci-dessous mesure
 * le taux RÉEL sur l'historique de chaque actif — rien n'est garanti.
 */

export const PARAMS = {
  rsiPeriod: 2,
  rsiEntry: 10,
  smaTrend: 200,
  smaExit: 5,
  atrPeriod: 14,
  atrMult: 2.5,
  maxHoldDays: 10,
} as const;

export interface Candle {
  time: number; // secondes epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number; // optionnel : utilisé par les détecteurs de volume
}

export type ExitReason = "objectif" | "stop" | "temps";

export interface Trade {
  entryIdx: number;
  exitIdx: number;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  reason: ExitReason;
}

export type Action = "ACHETER" | "VENDRE" | "CONSERVER" | "ATTENDRE";

export interface StrategyResult {
  action: Action;
  /** Position fictive ouverte selon la stratégie (si CONSERVER/VENDRE). */
  open: { entryPrice: number; stop: number; daysHeld: number } | null;
  /** Plan d'entrée si action === ACHETER. */
  entryPlan: { entry: number; stop: number } | null;
  /** Raison de la sortie si action === VENDRE. */
  exitReason: ExitReason | null;
  trades: Trade[];
  winRate: number | null; // 0..1
  avgWinPct: number | null;
  avgLossPct: number | null;
  totalPnlPct: number; // somme des pnl% (1 position à la fois)
  trend: "haussier" | "baissier";
  lastClose: number;
  prevClose: number | null;
  rsi2: number | null;
  rsi14: number | null;
  sma200: number | null;
  sma5: number | null;   // MM5 (règle de sortie) — exposée pour la réconciliation
  lastTime: number;      // date (epoch s) de la dernière bougie — fraîcheur des données
}

export function runStrategy(candles: Candle[]): StrategyResult | null {
  const n = candles.length;
  if (n < PARAMS.smaTrend + 5) return null;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const smaTrend = sma(closes, PARAMS.smaTrend);
  const smaExit = sma(closes, PARAMS.smaExit);
  const rsi2 = rsi(closes, PARAMS.rsiPeriod);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(highs, lows, closes, PARAMS.atrPeriod);

  const trades: Trade[] = [];
  let pos: { entryIdx: number; entryPrice: number; stop: number } | null = null;
  let lastAction: Action = "ATTENDRE";
  let lastExitReason: ExitReason | null = null;

  for (let i = PARAMS.smaTrend; i < n; i++) {
    let action: Action = "ATTENDRE";
    let exitReason: ExitReason | null = null;

    if (pos && i > pos.entryIdx) {
      const held = i - pos.entryIdx;
      if (closes[i] <= pos.stop) exitReason = "stop";
      else if (smaExit[i] !== null && closes[i] > smaExit[i]!) exitReason = "objectif";
      else if (held >= PARAMS.maxHoldDays) exitReason = "temps";

      if (exitReason) {
        trades.push({
          entryIdx: pos.entryIdx,
          exitIdx: i,
          entryPrice: pos.entryPrice,
          exitPrice: closes[i],
          pnlPct: (closes[i] / pos.entryPrice - 1) * 100,
          reason: exitReason,
        });
        pos = null;
        action = "VENDRE";
      } else {
        action = "CONSERVER";
      }
    } else if (
      !pos &&
      smaTrend[i] !== null &&
      closes[i] > smaTrend[i]! &&
      rsi2[i] !== null &&
      rsi2[i]! < PARAMS.rsiEntry &&
      atr14[i] !== null
    ) {
      pos = {
        entryIdx: i,
        entryPrice: closes[i],
        stop: closes[i] - PARAMS.atrMult * atr14[i]!,
      };
      action = "ACHETER";
    } else if (pos) {
      action = "CONSERVER";
    }

    if (i === n - 1) {
      lastAction = action;
      lastExitReason = exitReason;
    }
  }

  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const avg = (arr: Trade[]) =>
    arr.length ? arr.reduce((s, t) => s + t.pnlPct, 0) / arr.length : null;

  const last = n - 1;
  return {
    action: lastAction,
    open: pos
      ? {
          entryPrice: pos.entryPrice,
          stop: pos.stop,
          daysHeld: last - pos.entryIdx,
        }
      : null,
    entryPlan:
      lastAction === "ACHETER" && atr14[last] !== null
        ? {
            entry: closes[last],
            stop: closes[last] - PARAMS.atrMult * atr14[last]!,
          }
        : null,
    exitReason: lastExitReason,
    trades,
    winRate: trades.length ? wins.length / trades.length : null,
    avgWinPct: avg(wins),
    avgLossPct: avg(losses),
    totalPnlPct: trades.reduce((s, t) => s + t.pnlPct, 0),
    trend:
      smaTrend[last] !== null && closes[last] > smaTrend[last]!
        ? "haussier"
        : "baissier",
    lastClose: closes[last],
    prevClose: n > 1 ? closes[last - 1] : null,
    rsi2: rsi2[last],
    rsi14: rsi14[last],
    sma200: smaTrend[last],
    sma5: smaExit[last],
    lastTime: candles[last].time,
  };
}

/** Nombre d'actions à acheter pour risquer `riskPct`% du capital entre entrée et stop. */
export function positionSize(
  capital: number,
  riskPct: number,
  entry: number,
  stop: number
): number {
  const riskPerShare = entry - stop;
  if (riskPerShare <= 0 || capital <= 0) return 0;
  return Math.floor((capital * riskPct) / 100 / riskPerShare);
}

/* ─── Décision de SORTIE sur une position RÉELLE (fix #2) ───────────────────
 * Pure et testable. Source de vérité = la position réellement détenue, pas la
 * simulation. Le stop est géré en intra-day par le courtier ; ici on couvre
 * la prise de profit (clôture > MM5) et la sortie temps. */
export interface ExitDecision { exit: boolean; reason: ExitReason | null; }

export function evaluateExit(
  candles: Candle[],
  pos: { entryPrice: number; stop: number; daysHeld: number }
): ExitDecision {
  if (candles.length < PARAMS.smaExit + 1) return { exit: false, reason: null };
  const closes = candles.map((c) => c.close);
  const last = closes.length - 1;
  const close = closes[last];
  const sma5 = sma(closes, PARAMS.smaExit)[last];
  if (close <= pos.stop) return { exit: true, reason: "stop" };
  if (sma5 != null && close > sma5) return { exit: true, reason: "objectif" };
  if (pos.daysHeld >= PARAMS.maxHoldDays) return { exit: true, reason: "temps" };
  return { exit: false, reason: null };
}
