import { describe, it, expect } from "vitest";
import { evaluateSpcFx5, planStop, type SpcSignalInput } from "../src/strategy/spcfx5/signal";
import { DEFAULT_SPC_PARAMS, mergeParams, type SpcParams } from "../src/strategy/spcfx5/params";
import { aggregateHigherTf } from "../src/bars";
import type { SpcAsset } from "../src/strategy/spcfx5/types";
import type { Bar } from "../src/types";

const H1 = 3_600_000;
const T0 = Date.UTC(2026, 5, 1, 0, 0, 0);

const asset: SpcAsset = {
  std: "EURUSD",
  provider: "EUR/USD",
  category: "fx_major",
  assetClass: "fx",
  exchange: "FOREX",
  currency: "USD",
  country: "XX",
  enabled: true,
  costBps: 1.5,
  groups: ["usd:-1", "eur:+1"],
};

function bars(closes: number[]): Bar[] {
  return closes.map((close, i) => {
    const open = i > 0 ? closes[i - 1] : close;
    return {
      symbol: "EUR/USD",
      tf: "1h" as const,
      openTime: T0 + i * H1,
      open,
      high: Math.max(open, close) * 1.0008,
      low: Math.min(open, close) * 0.9992,
      close,
      volume: 1000,
      ticks: 10,
    };
  });
}

/**
 * Séquence taillée pour aligner les 7 conditions d'un LONG :
 * longue tendance haussière (SMA 200 au-dessus et orientée, ADX fort,
 * DI+ > DI-), courte respiration qui fait basculer l'UT Bot en short, puis
 * une bougie de reprise franche qui rebascule l'UT Bot ET casse le range.
 */
function longSetupCloses(): number[] {
  const out: number[] = [];
  for (let i = 0; i < 290; i++) out.push(100 + i * 0.6);
  const top = out[out.length - 1];
  for (let i = 1; i <= 10; i++) out.push(top - i * 3); // respiration
  out.push(top + 12); // reprise : bascule UT Bot + breakout
  return out;
}

function shortSetupCloses(): number[] {
  return longSetupCloses().map((c) => 1000 - c);
}

function inputFor(closes: number[], params: SpcParams = DEFAULT_SPC_PARAMS): SpcSignalInput {
  const h1 = bars(closes);
  return {
    asset,
    bars: h1,
    barsH4: aggregateHigherTf(h1, "4h"),
    barsD1: aggregateHigherTf(h1, "1d"),
    quote: null,
    news: null,
    params,
    // Bande large : ce test porte sur l'alignement, pas sur la volatilité.
    volatilityBand: { minAtrPct: 0, maxAtrPct: 100 },
  };
}

// Le filtre de session dépend de l'heure des bougies : neutralisé ici.
const PARAMS = mergeParams(DEFAULT_SPC_PARAMS, {
  session: { ...DEFAULT_SPC_PARAMS.session, enabled: false },
});

describe("evaluateSpcFx5 — alignement complet", () => {
  it("produit un LONG éligible quand les 7 conditions sont réunies", () => {
    const signal = evaluateSpcFx5(inputFor(longSetupCloses(), PARAMS));
    expect(signal.rejects).toEqual([]);
    expect(signal.side).toBe("long");
    expect(signal.eligible).toBe(true);
    expect(signal.score).toBeGreaterThanOrEqual(PARAMS.minScore);
    expect(signal.stopLoss).toBeLessThan(signal.price);
    expect(signal.takeProfit).toBeGreaterThan(signal.price);
  });

  it("produit un SHORT éligible sur la séquence symétrique", () => {
    const signal = evaluateSpcFx5(inputFor(shortSetupCloses(), PARAMS));
    expect(signal.rejects).toEqual([]);
    expect(signal.side).toBe("short");
    expect(signal.stopLoss).toBeGreaterThan(signal.price);
    expect(signal.takeProfit).toBeLessThan(signal.price);
  });

  it("détaille le score composant par composant, sans dépasser 100", () => {
    const signal = evaluateSpcFx5(inputFor(longSetupCloses(), PARAMS));
    expect(signal.parts).toHaveLength(7);
    const total = signal.parts.reduce((s, p) => s + p.points, 0);
    expect(Math.round(total)).toBe(signal.score);
    expect(signal.parts.every((p) => p.points >= 0 && p.points <= p.max)).toBe(true);
    expect(signal.parts.reduce((s, p) => s + p.max, 0)).toBe(100);
    // Chaque composant porte son explication : aucun score « boîte noire ».
    expect(signal.parts.every((p) => p.detail.length > 0)).toBe(true);
  });
});

describe("evaluateSpcFx5 — un critère manquant suffit à refuser", () => {
  const closes = longSetupCloses();

  it("ADX sous le seuil", () => {
    const params = mergeParams(PARAMS, {
      momentum: { ...PARAMS.momentum, minAdx: 95 },
    });
    const signal = evaluateSpcFx5(inputFor(closes, params));
    expect(signal.rejects).toContain("adx_below_threshold");
    expect(signal.side).toBe("flat");
  });

  it("pente de la SMA 200 insuffisante", () => {
    const params = mergeParams(PARAMS, { trend: { ...PARAMS.trend, minSlopePct: 500 } });
    expect(evaluateSpcFx5(inputFor(closes, params)).rejects).toContain("sma_slope_weak");
  });

  it("écart DI trop faible", () => {
    const params = mergeParams(PARAMS, {
      momentum: { ...PARAMS.momentum, minDiSpread: 0.99 },
    });
    expect(evaluateSpcFx5(inputFor(closes, params)).rejects).toContain("di_spread_weak");
  });

  it("bascule UT Bot absente sur la clôture", () => {
    // On retire la bougie de reprise : plus de bascule haussière.
    const signal = evaluateSpcFx5(inputFor(closes.slice(0, -1), PARAMS));
    expect(signal.rejects.some((r) => r.startsWith("utbot"))).toBe(true);
    expect(signal.side).toBe("flat");
  });

  it("breakout non confirmé", () => {
    const params = mergeParams(PARAMS, {
      breakout: { ...PARAMS.breakout, bufferAtrMult: 50 },
    });
    expect(evaluateSpcFx5(inputFor(closes, params)).rejects).toContain("breakout_not_confirmed");
  });

  it("prix trop proche de la SMA 200 (anti-chop)", () => {
    const params = mergeParams(PARAMS, {
      antiChop: { enabled: true, minDistanceToSmaAtr: 1000 },
    });
    expect(evaluateSpcFx5(inputFor(closes, params)).rejects).toContain("chop_too_close_to_sma");
  });

  it("volatilité hors bande", () => {
    const input = inputFor(closes, PARAMS);
    input.volatilityBand = { minAtrPct: 90, maxAtrPct: 100 };
    expect(evaluateSpcFx5(input).rejects).toContain("volatility_too_low");
  });

  it("score sous le minimum, même sans autre rejet", () => {
    const params = mergeParams(PARAMS, { minScore: 100 });
    const signal = evaluateSpcFx5(inputFor(closes, params));
    expect(signal.rejects).toContain("score_below_min");
    expect(signal.side).toBe("flat");
    expect(signal.eligible).toBe(false);
  });

  it("annonce macro dans la fenêtre", () => {
    const input = inputFor(closes, PARAMS);
    const lastBar = input.bars[input.bars.length - 1];
    input.news = [{ ts: lastBar.openTime + H1, impact: "high", currencies: ["EUR"] }];
    expect(evaluateSpcFx5(input).rejects).toContain("news_blackout");
  });
});

describe("evaluateSpcFx5 — données insuffisantes ou périmées", () => {
  it("refuse un historique trop court sans rien calculer", () => {
    const signal = evaluateSpcFx5(inputFor([100, 101, 102], PARAMS));
    expect(signal.rejects).toEqual(["data_insufficient"]);
    expect(signal.parts).toHaveLength(0);
  });

  it("refuse une cotation périmée", () => {
    const input = inputFor(longSetupCloses(), PARAMS);
    input.quote = {
      symbol: "EUR/USD",
      assetClass: "fx",
      exchange: "FOREX",
      currency: "USD",
      bid: null,
      ask: null,
      last: 100,
      volume: null,
      ts: T0,
      stale: true,
    };
    expect(evaluateSpcFx5(input).rejects).toEqual(["data_stale"]);
  });
});

describe("planStop", () => {
  const series = bars(longSetupCloses());

  it("rejette un stop trop serré et un stop trop large", () => {
    const tight = planStop(100, "long", 1, series, 99, {
      ...PARAMS.stop,
      atrMult: 0.1,
      technical: "none",
    });
    expect(tight.reject).toBe("stop_too_tight");

    const wide = planStop(100, "long", 1, series, 99, {
      ...PARAMS.stop,
      atrMult: 10,
      technical: "none",
    });
    expect(wide.reject).toBe("stop_too_wide");
  });

  it("retient la référence la plus large entre ATR et niveau technique", () => {
    // Stop UT Bot à 3 unités sous le prix, ATR × 2 = 2 → c'est l'UT Bot qui gagne.
    const plan = planStop(100, "long", 1, series, 97, {
      ...PARAMS.stop,
      atrMult: 2,
      technical: "utbot",
    });
    expect(plan.reject).toBeNull();
    expect(plan.riskPerUnit).toBeCloseTo(3, 5);
    expect(plan.stopLoss).toBeCloseTo(97, 5);
    expect(plan.takeProfit).toBeCloseTo(106, 5); // 2R
  });

  it("place le take-profit au ratio configuré, des deux côtés", () => {
    const short = planStop(100, "short", 1, series, null, {
      ...PARAMS.stop,
      atrMult: 2,
      technical: "none",
      takeProfitR: 3,
    });
    expect(short.stopLoss).toBeCloseTo(102, 5);
    expect(short.takeProfit).toBeCloseTo(94, 5);
  });
});

describe("mergeParams", () => {
  it("fusionne section par section sans écraser le reste", () => {
    const merged = mergeParams(DEFAULT_SPC_PARAMS, { trend: { minSlopePct: 1 } as never });
    expect(merged.trend.minSlopePct).toBe(1);
    expect(merged.trend.smaPeriod).toBe(DEFAULT_SPC_PARAMS.trend.smaPeriod);
    expect(merged.momentum).toEqual(DEFAULT_SPC_PARAMS.momentum);
  });
});
