import { runStrategy, type StrategyResult } from "../../src/trading/strategy";
import { WATCHLIST } from "../../src/trading/data";
import type { Candle } from "../../src/trading/strategy";

/* ─── Analyse du marché côté serveur (cron, sans passer par /api/market) ── */

export interface SignalRow {
  symbol: string;
  r: StrategyResult;
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
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ time: ts[i], open: o, high: h, low: l, close: c });
  }
  return candles;
}

export async function analyzeMarket(): Promise<{
  rows: SignalRow[];
  errors: string[];
}> {
  const rows: SignalRow[] = [];
  const errors: string[] = [];
  await Promise.all(
    WATCHLIST.map(async (symbol) => {
      try {
        const candles = await fetchYahooCandles(symbol);
        const r = runStrategy(candles);
        if (r) rows.push({ symbol, r });
        else errors.push(`${symbol} : historique insuffisant`);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `Erreur ${symbol}`);
      }
    })
  );
  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { rows, errors };
}
