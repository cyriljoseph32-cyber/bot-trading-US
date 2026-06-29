import type { Candle } from "./strategy";

/* ─── Univers surveillé : actifs US liquides ─────────────────────────────── */
export const INDEX_ETFS = ["SPY", "QQQ", "DIA", "IWM"] as const;

export const WATCHLIST = [
  "SPY", "QQQ", "DIA", "IWM",
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO",
  "JPM", "V", "UNH", "XOM", "KO", "PG", "HD", "COST",
] as const;

export const NAMES: Record<string, string> = {
  SPY: "S&P 500 (ETF)", QQQ: "Nasdaq 100 (ETF)", DIA: "Dow Jones (ETF)",
  IWM: "Russell 2000 (ETF)",
  AAPL: "Apple", MSFT: "Microsoft", NVDA: "Nvidia", AMZN: "Amazon",
  GOOGL: "Alphabet", META: "Meta", TSLA: "Tesla", AVGO: "Broadcom",
  JPM: "JPMorgan", V: "Visa", UNH: "UnitedHealth", XOM: "ExxonMobil",
  KO: "Coca-Cola", PG: "Procter & Gamble", HD: "Home Depot", COST: "Costco",
};

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

/** Récupère ~2 ans de bougies journalières via /api/market (proxy Yahoo). */
export async function fetchCandles(symbol: string): Promise<Candle[]> {
  const res = await fetch(
    `/api/market?symbol=${encodeURIComponent(symbol)}&range=2y`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${symbol}`);
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
