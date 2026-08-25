import { describe, it, expect } from "vitest";
import { aggregateHigherTf } from "../src/bars";
import { higherTfTrend, mtfAllows } from "../src/strategy/spcfx5/mtf";
import type { Bar } from "../src/types";

const H1 = 3_600_000;
const T0 = Date.UTC(2026, 5, 1, 0, 0, 0); // lundi 1er juin 2026, minuit UTC

function h1Bars(count: number, closeAt: (i: number) => number): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < count; i++) {
    const close = closeAt(i);
    const open = i > 0 ? closeAt(i - 1) : close;
    bars.push({
      symbol: "TEST",
      tf: "1h",
      openTime: T0 + i * H1,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 1000,
      ticks: 10,
    });
  }
  return bars;
}

describe("aggregateHigherTf", () => {
  it("regroupe 4 bougies H1 en une bougie H4 alignée sur l'epoch UTC", () => {
    const bars = h1Bars(8, (i) => 100 + i);
    const h4 = aggregateHigherTf(bars, "4h");
    expect(h4).toHaveLength(2);
    expect(h4[0].openTime).toBe(T0);
    expect(h4[0].open).toBe(bars[0].open);
    expect(h4[0].close).toBe(bars[3].close);
    expect(h4[0].high).toBe(Math.max(...bars.slice(0, 4).map((b) => b.high)));
    expect(h4[0].low).toBe(Math.min(...bars.slice(0, 4).map((b) => b.low)));
    expect(h4[0].volume).toBe(4000);
  });

  it("ANTI-LOOKAHEAD : n'émet jamais une période H4 incomplète", () => {
    // 6 bougies H1 = une H4 complète + 2 bougies de la H4 suivante, en cours.
    const bars = h1Bars(6, (i) => 100 + i);
    const h4 = aggregateHigherTf(bars, "4h");
    expect(h4).toHaveLength(1);
    expect(h4[0].openTime).toBe(T0);
  });

  it("ANTI-LOOKAHEAD : n'émet la bougie D1 qu'une fois les 24 heures écoulées", () => {
    expect(aggregateHigherTf(h1Bars(23, (i) => 100 + i), "1d")).toHaveLength(0);
    expect(aggregateHigherTf(h1Bars(24, (i) => 100 + i), "1d")).toHaveLength(1);
  });

  it("exclut les bougies aberrantes et refuse d'agréger vers un TF plus court", () => {
    const bars = h1Bars(4, () => 100);
    bars[2].outlier = true;
    bars[2].high = 9999;
    const h4 = aggregateHigherTf(bars, "4h");
    expect(h4[0].high).toBeLessThan(200);
    expect(aggregateHigherTf(bars, "1h")).toHaveLength(0);
  });
});

describe("higherTfTrend", () => {
  const rising = aggregateHigherTf(h1Bars(600, (i) => 100 + i * 0.5), "4h");
  const asOf = T0 + 600 * H1;

  it("détecte une tendance haussière confirmée par la SMA", () => {
    expect(higherTfTrend(rising, "4h", 50, asOf)).toBe("long");
  });

  it("détecte une tendance baissière", () => {
    const falling = aggregateHigherTf(h1Bars(600, (i) => 500 - i * 0.5), "4h");
    expect(higherTfTrend(falling, "4h", 50, asOf)).toBe("short");
  });

  it("renvoie unknown quand l'historique est trop court", () => {
    expect(higherTfTrend(rising.slice(-10), "4h", 50, asOf)).toBe("unknown");
  });

  it("ignore les bougies H4 dont la période n'est pas close à `asOf`", () => {
    // Vu depuis le tout début, aucune bougie H4 n'est encore terminée.
    expect(higherTfTrend(rising, "4h", 50, T0)).toBe("unknown");
  });
});

describe("mtfAllows", () => {
  it("bloque une direction contredite par le timeframe supérieur", () => {
    expect(mtfAllows("short", "long")).toBe(false);
    expect(mtfAllows("long", "long")).toBe(true);
  });

  it("bloque aussi une tendance supérieure indécise", () => {
    expect(mtfAllows("flat", "long")).toBe(false);
  });

  it("reste neutre quand la donnée manque — on ne bloque pas sur une absence", () => {
    expect(mtfAllows("unknown", "long")).toBe(true);
    expect(mtfAllows("unknown", "short")).toBe(true);
  });
});
