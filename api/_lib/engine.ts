import { runStrategy, type StrategyResult } from "../../src/trading/strategy";
import { WATCHLIST } from "../../src/trading/data";
import type { Candle } from "../../src/trading/strategy";
import { scoreCandles, type ScoreBand } from "../../src/trading/scoring";
import { backtest, DEFAULT_COSTS } from "../../src/trading/backtest";

/* ─── Analyse du marché côté serveur (cron, sans passer par /api/market) ── */

export interface SignalRow {
  symbol: string;
  r: StrategyResult;
  /** Win-rate NET (frais + slippage), 0..1 — fix #3. */
  winRateNet?: number | null;
  score?: number; // score 0-100 (Phase 4)
  band?: ScoreBand;
}

interface YahooChart {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
}

async function fetchYahooCandles(symbol: string): Promise<Candle[]> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=2y&interval=1d`,
    { headers: { "user-agent": "Mozilla/5.0 (compatible; SignalBot/1.0)" } }
  );
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} pour ${symbol}`);
  const data: YahooChart = await res.json();

  const result = data.chart?.result?.[0];
  const ts = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!ts || !quote?.close) {
    throw new Error(
      data.chart?.error?.description ?? `Données indisponibles pour ${symbol}`
    );
  }

  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close[i];
    const v = quote.volume?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: v ?? undefined });
  }
  return candles;
}

export async function analyzeMarket(): Promise<{
  rows: SignalRow[];
  errors: string[];
  /** Epoch (s) de la dernière bougie la plus récente, tous actifs confondus. */
  asOf: number | null;
  /** true si les données ne datent pas du jour de bourse courant (US/Eastern). */
  stale: boolean;
}> {
  const rows: SignalRow[] = [];
  const errors: string[] = [];
  await Promise.all(
    WATCHLIST.map(async (symbol) => {
      try {
        const candles = await fetchYahooCandles(symbol);
        const r = runStrategy(candles);
        if (r) {
          // Fix #3 : win-rate NET (frais + slippage), pas le brut optimiste.
          const net = backtest(r.trades, DEFAULT_COSTS).winRate;
          const sc = scoreCandles(candles, net);
          rows.push({ symbol, r, winRateNet: net, score: sc.score, band: sc.band });
        } else {
          errors.push(`${symbol} : historique insuffisant`);
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `Erreur ${symbol}`);
      }
    })
  );
  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));

  // Fraîcheur des données (fix #10) : la dernière bougie doit dater d'aujourd'hui
  // (heure de New York), sinon on n'exécute aucun ordre (jour férié, données figées).
  const asOf = rows.length
    ? Math.max(...rows.map((x) => x.r.lastTime))
    : null;
  const stale = asOf == null ? true : !isSameNyDay(asOf * 1000, Date.now());
  return { rows, errors, asOf, stale };
}

/** Deux instants tombent-ils le même jour calendaire à New York ? */
function isSameNyDay(aMs: number, bMs: number): boolean {
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(ms));
  return fmt(aMs) === fmt(bMs);
}
