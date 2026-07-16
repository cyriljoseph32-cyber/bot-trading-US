/* ─── Pipeline de stratégie temps réel (pur, explicable, testable) ─────────
 *
 * À chaque clôture de bougie, calcule pour un symbole une note 0-100 à partir
 * de filtres EXPLICITES — chaque filtre produit des points et un code raison.
 * Aucun signal « boîte noire » : le dashboard peut afficher chaque
 * contribution. Réutilise les indicateurs éprouvés de src/trading/indicators.
 *
 * Filtres (max 100 pts) :
 *   tendance      25  structure des moyennes mobiles + pente
 *   momentum      20  RSI(14) + rate of change
 *   volatilité    15  ATR% dans une bande exploitable
 *   volume        10  volume vs sa moyenne (actions ; neutre pour FX)
 *   spread        10  bid/ask en points de base sous le plafond
 *   corrélation   10  diversification vs le benchmark
 *   régime        10  contexte de marché global (risk on/off)
 *
 * La confiance (0..1) reflète la complétude des données et la fraîcheur.
 */

import { sma, rsi, atr } from "../../../src/trading/indicators";
import { rollingCorrelation } from "./correlation";
import type { Bar, Quote, ReasonCode, ScoredSignal, Side, Timeframe } from "../types";

export type Regime = "risk_on" | "risk_off" | "neutral";

export interface PipelineInput {
  symbol: string;
  assetClass: "equity" | "fx" | "crypto";
  tf: Timeframe;
  /** Bougies closes, aberrations exclues, openTime croissant. */
  bars: Bar[];
  /** Dernière cotation (spread, staleness). */
  quote: Quote | null;
  /** Clôtures du benchmark (même timeframe) pour la corrélation. */
  benchmarkCloses: number[];
  regime: Regime;
  /** Plafond de spread en points de base. */
  maxSpreadBps: number;
}

const MIN_BARS = 60;
const CORR_WINDOW = 60;

/** Détermine le régime de marché à partir des bougies du benchmark. */
export function detectRegime(benchmarkBars: Bar[]): Regime {
  if (benchmarkBars.length < MIN_BARS) return "neutral";
  const closes = benchmarkBars.map((b) => b.close);
  const highs = benchmarkBars.map((b) => b.high);
  const lows = benchmarkBars.map((b) => b.low);

  const sma50 = last(sma(closes, 50));
  const atr14 = last(atr(highs, lows, closes, 14));
  const price = closes[closes.length - 1];
  if (sma50 === null || atr14 === null) return "neutral";

  const atrPct = (atr14 / price) * 100;
  const trendUp = price > sma50;
  // Volatilité élevée = régime défensif quelle que soit la tendance.
  if (atrPct > 1.5) return "risk_off";
  return trendUp ? "risk_on" : "risk_off";
}

/** Spread bid/ask en points de base (null si non coté). */
export function spreadBps(quote: Quote | null): number | null {
  if (!quote || quote.bid === null || quote.ask === null || quote.bid <= 0) return null;
  const mid = (quote.bid + quote.ask) / 2;
  return ((quote.ask - quote.bid) / mid) * 10_000;
}

export function evaluate(input: PipelineInput): ScoredSignal {
  const reasons: ReasonCode[] = [];
  const parts: ScoredSignal["parts"] = [];
  const now = input.quote?.ts ?? (input.bars.at(-1)?.openTime ?? 0);
  const price = input.quote?.last ?? input.bars.at(-1)?.close ?? 0;

  const base: ScoredSignal = {
    symbol: input.symbol,
    assetClass: input.assetClass,
    tf: input.tf,
    side: "flat",
    score: 0,
    confidence: 0,
    reasons,
    parts,
    price,
    ts: now,
  };

  if (input.bars.length < MIN_BARS) {
    reasons.push("data_insufficient");
    return base;
  }
  if (input.quote?.stale) {
    reasons.push("data_stale");
    return base;
  }

  const closes = input.bars.map((b) => b.close);
  const highs = input.bars.map((b) => b.high);
  const lows = input.bars.map((b) => b.low);
  const volumes = input.bars.map((b) => b.volume);

  let score = 0;
  let bullish = 0; // votes directionnels des filtres
  let bearish = 0;

  // 1) Tendance (25) : prix vs MM20/MM50 + pente de la MM20.
  const sma20Series = sma(closes, 20);
  const sma20 = last(sma20Series);
  const sma50 = last(sma(closes, 50));
  const sma20Prev = sma20Series[sma20Series.length - 6] ?? null;
  {
    let pts = 0;
    if (sma20 !== null && sma50 !== null && sma20Prev !== null) {
      const slope = (sma20 - sma20Prev) / sma20Prev;
      const up = price > sma20 && sma20 > sma50 && slope > 0;
      const down = price < sma20 && sma20 < sma50 && slope < 0;
      if (up) {
        pts = 25;
        bullish += 2;
        reasons.push("trend_up");
      } else if (down) {
        pts = 25;
        bearish += 2;
        reasons.push("trend_down");
      } else {
        pts = 8;
        reasons.push("trend_flat");
      }
    }
    score += pts;
    parts.push({ filter: "tendance", value: sma20 ?? 0, points: pts, max: 25 });
  }

  // 2) Momentum (20) : RSI(14) + ROC 10 bougies.
  const rsi14 = last(rsi(closes, 14));
  {
    let pts = 0;
    const roc = closes[closes.length - 11] ? price / closes[closes.length - 11] - 1 : 0;
    if (rsi14 !== null) {
      if (rsi14 > 55 && rsi14 < 75 && roc > 0) {
        pts = 20;
        bullish += 1;
        reasons.push("momentum_strong");
      } else if (rsi14 < 45 && rsi14 > 25 && roc < 0) {
        pts = 20;
        bearish += 1;
        reasons.push("momentum_strong");
      } else if (rsi14 >= 75) {
        pts = 5;
        reasons.push("momentum_overbought");
      } else if (rsi14 <= 25) {
        pts = 5;
        reasons.push("momentum_oversold");
      } else {
        pts = 8;
        reasons.push("momentum_weak");
      }
    }
    score += pts;
    parts.push({ filter: "momentum", value: rsi14 ?? 50, points: pts, max: 20 });
  }

  // 3) Volatilité (15) : ATR% dans une bande exploitable (ni morte ni extrême).
  const atr14 = last(atr(highs, lows, closes, 14));
  {
    let pts = 0;
    if (atr14 !== null && price > 0) {
      const atrPct = (atr14 / price) * 100;
      const [lo, hi] = input.assetClass === "fx" ? [0.02, 0.5] : [0.05, 2];
      if (atrPct >= lo && atrPct <= hi) {
        pts = 15;
        reasons.push("volatility_normal");
      } else if (atrPct > hi) {
        pts = 3;
        reasons.push("volatility_high");
      } else {
        pts = 5;
        reasons.push("volatility_low");
      }
      parts.push({ filter: "volatilite", value: atrPct, points: pts, max: 15 });
    } else {
      parts.push({ filter: "volatilite", value: 0, points: 0, max: 15 });
    }
    score += pts;
  }

  // 4) Volume (10) : vs MM20 du volume. FX spot n'a pas de volume → neutre.
  {
    let pts = 5;
    const hasVolume = input.assetClass !== "fx" && volumes.some((v) => v > 0);
    if (hasVolume) {
      const volSma = last(sma(volumes, 20));
      const lastVol = volumes[volumes.length - 1];
      if (volSma !== null && volSma > 0) {
        const ratio = lastVol / volSma;
        if (ratio > 1.5) {
          pts = 10;
          reasons.push("volume_surge");
        } else if (ratio < 0.3) {
          pts = 2;
          reasons.push("volume_thin");
        } else {
          pts = 6;
          reasons.push("volume_normal");
        }
      }
    } else {
      reasons.push("volume_normal");
    }
    score += pts;
    parts.push({ filter: "volume", value: 0, points: pts, max: 10 });
  }

  // 5) Spread (10) : gate de qualité d'exécution.
  {
    const bps = spreadBps(input.quote);
    let pts = 5; // inconnu → neutre
    if (bps !== null) {
      if (bps <= input.maxSpreadBps) {
        pts = 10;
        reasons.push("spread_ok");
      } else {
        pts = 0;
        reasons.push("spread_wide");
      }
    }
    score += pts;
    parts.push({ filter: "spread", value: bps ?? -1, points: pts, max: 10 });
  }

  // 6) Corrélation (10) : faible corrélation au benchmark = diversification.
  {
    const corr = rollingCorrelation(closes, input.benchmarkCloses, CORR_WINDOW);
    let pts = 5;
    if (corr !== null) {
      if (Math.abs(corr) < 0.5) {
        pts = 10;
        reasons.push("correlation_low");
      } else {
        pts = 3;
        reasons.push("correlation_high");
      }
    }
    score += pts;
    parts.push({ filter: "correlation", value: corr ?? 0, points: pts, max: 10 });
  }

  // 7) Régime (10) : le contexte global gate la note directionnelle.
  {
    let pts = 5;
    if (input.regime === "risk_on") {
      pts = bullish >= bearish ? 10 : 3;
      reasons.push("regime_risk_on");
    } else if (input.regime === "risk_off") {
      pts = bearish > bullish ? 10 : 3;
      reasons.push("regime_risk_off");
    } else {
      reasons.push("regime_neutral");
    }
    score += pts;
    parts.push({ filter: "regime", value: 0, points: pts, max: 10 });
  }

  // Direction : majorité des votes tendance+momentum ; flat si indécis.
  const side: Side = bullish > bearish ? "long" : bearish > bullish ? "short" : "flat";

  // Confiance : complétude (bougies) × fraîcheur × accord des filtres.
  const dataCompleteness = Math.min(1, input.bars.length / (MIN_BARS * 2));
  const agreement = bullish + bearish > 0 ? Math.abs(bullish - bearish) / (bullish + bearish) : 0;
  const confidence = round2(dataCompleteness * (0.5 + 0.5 * agreement));

  return {
    ...base,
    side,
    score: Math.max(0, Math.min(100, Math.round(score))),
    confidence,
  };
}

function last(arr: (number | null)[]): number | null {
  return arr.length ? arr[arr.length - 1] : null;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
