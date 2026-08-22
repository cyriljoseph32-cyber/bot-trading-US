import { describe, it, expect } from "vitest";
import {
  adx,
  utBot,
  slopePct,
  lastSwingHigh,
  lastSwingLow,
  donchian,
  lastOf,
} from "../src/strategy/spcfx5/indicators";

/** Série OHLC construite à partir d'une fonction de clôture. */
function series(count: number, closeAt: (i: number) => number, range = 0.5) {
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  for (let i = 0; i < count; i++) {
    const c = closeAt(i);
    closes.push(c);
    highs.push(c + range);
    lows.push(c - range);
  }
  return { highs, lows, closes };
}

describe("adx", () => {
  it("ne renvoie rien tant que la fenêtre n'est pas pleine", () => {
    const { highs, lows, closes } = series(20, (i) => 100 + i);
    const out = adx(highs, lows, closes, 14);
    expect(out.every((v) => v === null)).toBe(true);
  });

  it("place DI+ au-dessus de DI- dans une tendance haussière franche", () => {
    const { highs, lows, closes } = series(120, (i) => 100 + i);
    const point = lastOf(adx(highs, lows, closes, 14));
    expect(point).not.toBeNull();
    expect(point!.plusDi).toBeGreaterThan(point!.minusDi);
    expect(point!.adx).toBeGreaterThan(25);
  });

  it("inverse les DI dans une tendance baissière", () => {
    const { highs, lows, closes } = series(120, (i) => 300 - i);
    const point = lastOf(adx(highs, lows, closes, 14));
    expect(point!.minusDi).toBeGreaterThan(point!.plusDi);
  });

  it("laisse l'ADX faible dans un marché sans direction", () => {
    const { highs, lows, closes } = series(200, (i) => 100 + Math.sin(i / 2) * 2);
    const point = lastOf(adx(highs, lows, closes, 14));
    expect(point).not.toBeNull();
    expect(point!.adx).toBeLessThan(25);
  });
});

describe("utBot", () => {
  it("garde un stop sous le prix et le fait monter en tendance haussière", () => {
    const { highs, lows, closes } = series(80, (i) => 100 + i);
    const out = utBot(highs, lows, closes, { keyValue: 1, atrPeriod: 10 });
    const last = lastOf(out)!;
    expect(last.position).toBe(1);
    expect(last.stop).toBeLessThan(closes[closes.length - 1]);
    // Le stop suiveur ne recule jamais tant que la tendance tient.
    const stops = out.filter((p) => p !== null).map((p) => p!.stop);
    for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThanOrEqual(stops[i - 1]);
  });

  it("bascule en short quand le prix casse le stop suiveur", () => {
    // 60 bougies de hausse, puis un décrochage franc.
    const { highs, lows, closes } = series(70, (i) => (i < 60 ? 100 + i : 160 - (i - 59) * 12));
    const out = utBot(highs, lows, closes, { keyValue: 1, atrPeriod: 10 });
    const flips = out.filter((p) => p?.flip === "short");
    expect(flips.length).toBeGreaterThan(0);
    expect(lastOf(out)!.position).toBe(-1);
  });

  it("remet barsSinceFlip à zéro sur la bougie de bascule", () => {
    const { highs, lows, closes } = series(70, (i) => (i < 60 ? 100 + i : 160 - (i - 59) * 12));
    const out = utBot(highs, lows, closes, { keyValue: 1, atrPeriod: 10 });
    const flipIndex = out.findIndex((p) => p?.flip === "short");
    expect(out[flipIndex]!.barsSinceFlip).toBe(0);
    expect(out[flipIndex + 1]!.barsSinceFlip).toBe(1);
  });
});

describe("slopePct", () => {
  it("mesure une pente positive et une pente négative", () => {
    const rising = [100, 101, 102, 103, 104, 105];
    expect(slopePct(rising, 5)).toBeCloseTo(5, 5);
    const falling = [105, 104, 103, 102, 101, 100];
    expect(slopePct(falling, 5)).toBeCloseTo(-4.7619, 3);
  });

  it("renvoie null si la fenêtre dépasse la série ou contient un trou", () => {
    expect(slopePct([100, 101], 5)).toBeNull();
    expect(slopePct([null, null, 100], 2)).toBeNull();
  });
});

describe("swings", () => {
  it("renvoie le DERNIER pivot, pas le plus extrême", () => {
    // 15 (index 2) est plus haut, mais 13 (index 5) est le pivot le plus récent :
    // c'est lui qui décrit la structure de prix actuelle.
    const highs = [10, 12, 15, 12, 11, 13, 12, 11, 10];
    expect(lastSwingHigh(highs, 2)).toBe(13);
    const lows = [10, 8, 5, 8, 9, 7, 9, 10, 11];
    expect(lastSwingLow(lows, 2)).toBe(7);
  });

  it("renvoie null quand aucun pivot n'est confirmé", () => {
    expect(lastSwingHigh([1, 2, 3, 4, 5, 6, 7], 2)).toBeNull();
  });
});

describe("donchian", () => {
  it("exclut la dernière bougie de son propre range", () => {
    const highs = [10, 11, 12, 30];
    const lows = [9, 8, 7, 1];
    const channel = donchian(highs, lows, 3);
    expect(channel).toEqual({ upper: 12, lower: 7 });
  });

  it("renvoie null si l'historique est trop court", () => {
    expect(donchian([1, 2], [1, 2], 5)).toBeNull();
  });
});
