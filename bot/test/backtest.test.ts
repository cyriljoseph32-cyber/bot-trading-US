import { describe, it, expect } from "vitest";
import { runBacktest, syntheticBars } from "../src/backtest";
import type { Bar } from "../src/types";

describe("syntheticBars", () => {
  it("déterministe : même graine → même série", () => {
    const a = syntheticBars("X", 100, 100, 42).map((b) => b.close);
    const b = syntheticBars("X", 100, 100, 42).map((b) => b.close);
    expect(a).toEqual(b);
  });

  it("graines différentes → séries différentes", () => {
    const a = syntheticBars("X", 100, 100, 1).map((b) => b.close);
    const b = syntheticBars("X", 100, 100, 2).map((b) => b.close);
    expect(a).not.toEqual(b);
  });
});

describe("runBacktest", () => {
  it("rejoue le pipeline + risque + paper broker et produit un résultat fini", () => {
    const bars = new Map<string, Bar[]>();
    bars.set("SPY", syntheticBars("SPY", 300, 500, 42));
    bars.set("AAPL", syntheticBars("AAPL", 300, 200, 7));

    const result = runBacktest(bars, "SPY");
    expect(Number.isFinite(result.finalEquity)).toBe(true);
    expect(result.finalEquity).toBeGreaterThan(0);
    expect(result.trades).toBeGreaterThanOrEqual(0);
    expect(result.rejects).toBeGreaterThanOrEqual(0);
  });
});
