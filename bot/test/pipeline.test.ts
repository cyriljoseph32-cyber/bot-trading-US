import { describe, it, expect } from "vitest";
import { evaluate, detectRegime, spreadBps, type PipelineInput } from "../src/strategy/pipeline";
import type { Bar, Quote } from "../src/types";

const T0 = Date.UTC(2026, 6, 15, 8, 0, 0);

/** Série de bougies 15m à partir d'une fonction de prix. */
function makeBars(count: number, priceAt: (i: number) => number, volume = 1000): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < count; i++) {
    const p = priceAt(i);
    const prev = i > 0 ? priceAt(i - 1) : p;
    bars.push({
      symbol: "TEST", tf: "15m", openTime: T0 + i * 900_000,
      open: prev, high: Math.max(prev, p) * 1.001, low: Math.min(prev, p) * 0.999,
      close: p, volume, ticks: 5,
    });
  }
  return bars;
}

function makeQuote(price: number, over: Partial<Quote> = {}): Quote {
  return {
    symbol: "TEST", assetClass: "equity", exchange: "NYSE", currency: "USD",
    bid: price * 0.9995, ask: price * 1.0005, last: price, volume: 1000,
    ts: T0 + 200 * 900_000, stale: false,
    ...over,
  };
}

function input(over: Partial<PipelineInput> = {}): PipelineInput {
  const bars = makeBars(150, (i) => 100 * (1 + 0.002 * i)); // tendance haussière régulière
  return {
    symbol: "TEST", assetClass: "equity", tf: "15m",
    bars, quote: makeQuote(bars.at(-1)!.close),
    benchmarkCloses: makeBars(150, (i) => 500 + Math.sin(i / 5) * 5).map((b) => b.close),
    regime: "risk_on", maxSpreadBps: 30,
    ...over,
  };
}

describe("evaluate — garde-fous de données", () => {
  it("historique insuffisant → score 0, raison explicite", () => {
    const s = evaluate(input({ bars: makeBars(10, () => 100) }));
    expect(s.score).toBe(0);
    expect(s.side).toBe("flat");
    expect(s.reasons).toContain("data_insufficient");
  });

  it("cotation stale → score 0, raison data_stale", () => {
    const s = evaluate(input({ quote: makeQuote(100, { stale: true }) }));
    expect(s.score).toBe(0);
    expect(s.reasons).toContain("data_stale");
  });
});

describe("evaluate — signaux explicables", () => {
  it("tendance haussière nette → side long, score élevé, raisons détaillées", () => {
    const s = evaluate(input());
    expect(s.side).toBe("long");
    expect(s.score).toBeGreaterThanOrEqual(60);
    expect(s.reasons).toContain("trend_up");
    expect(s.reasons).toContain("regime_risk_on");
    // Chaque filtre a une contribution auditable.
    expect(s.parts.map((p) => p.filter)).toEqual(
      ["tendance", "momentum", "volatilite", "volume", "spread", "correlation", "regime"]
    );
    expect(s.confidence).toBeGreaterThan(0);
    expect(s.confidence).toBeLessThanOrEqual(1);
  });

  it("tendance baissière nette → side short", () => {
    const bars = makeBars(150, (i) => 100 * (1 - 0.002 * i));
    const s = evaluate(input({ bars, quote: makeQuote(bars.at(-1)!.close), regime: "risk_off" }));
    expect(s.side).toBe("short");
    expect(s.reasons).toContain("trend_down");
  });

  it("spread trop large → raison spread_wide et 0 point sur ce filtre", () => {
    const last = input().bars.at(-1)!.close;
    const s = evaluate(input({ quote: makeQuote(last, { bid: last * 0.99, ask: last * 1.01 }) }));
    expect(s.reasons).toContain("spread_wide");
    expect(s.parts.find((p) => p.filter === "spread")!.points).toBe(0);
  });

  it("corrélation forte au benchmark → correlation_high", () => {
    const bars = makeBars(150, (i) => 100 * (1 + 0.002 * i));
    const s = evaluate(input({ bars, benchmarkCloses: bars.map((b) => b.close * 5) }));
    expect(s.reasons).toContain("correlation_high");
  });
});

describe("detectRegime", () => {
  it("benchmark haussier calme → risk_on ; baissier → risk_off", () => {
    expect(detectRegime(makeBars(100, (i) => 500 * (1 + 0.001 * i)))).toBe("risk_on");
    expect(detectRegime(makeBars(100, (i) => 500 * (1 - 0.001 * i)))).toBe("risk_off");
  });

  it("historique insuffisant → neutral", () => {
    expect(detectRegime(makeBars(10, () => 500))).toBe("neutral");
  });
});

describe("spreadBps", () => {
  it("calcule le spread en points de base", () => {
    expect(spreadBps(makeQuote(100, { bid: 99.95, ask: 100.05 }))).toBeCloseTo(10, 1);
    expect(spreadBps(makeQuote(100, { bid: null }))).toBeNull();
    expect(spreadBps(null)).toBeNull();
  });
});
