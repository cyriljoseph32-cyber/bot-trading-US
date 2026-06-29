import { describe, it, expect } from "vitest";
import { sma, rsi, atr } from "./indicators";

describe("sma", () => {
  it("renvoie null tant que la fenêtre n'est pas pleine, puis la moyenne", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("période 1 = la valeur elle-même", () => {
    expect(sma([10, 20, 30], 1)).toEqual([10, 20, 30]);
  });

  it("série constante → moyenne constante", () => {
    const out = sma([5, 5, 5, 5], 2);
    expect(out).toEqual([null, 5, 5, 5]);
  });
});

describe("rsi (Wilder)", () => {
  it("hausse monotone → RSI = 100 (aucune perte)", () => {
    const out = rsi([1, 2, 3, 4, 5, 6, 7, 8], 14);
    // série trop courte pour period 14 → tout null
    expect(out.every((v) => v === null)).toBe(true);

    const out2 = rsi([1, 2, 3, 4, 5], 2);
    // après l'amorçage, RSI doit valoir 100 (que des gains)
    const last = out2[out2.length - 1];
    expect(last).toBe(100);
  });

  it("baisse monotone → RSI = 0", () => {
    const out = rsi([5, 4, 3, 2, 1], 2);
    expect(out[out.length - 1]).toBe(0);
  });

  it("reste borné dans [0, 100]", () => {
    const series = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    const out = rsi(series, 14).filter((v): v is number => v !== null);
    expect(out.length).toBeGreaterThan(0);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe("atr (Wilder)", () => {
  it("série plate sans gaps → ATR = amplitude haut-bas constante", () => {
    const n = 20;
    const highs = new Array(n).fill(11);
    const lows = new Array(n).fill(10);
    const closes = new Array(n).fill(10.5);
    const out = atr(highs, lows, closes, 14);
    const last = out[out.length - 1];
    expect(last).not.toBeNull();
    expect(last!).toBeCloseTo(1, 6); // true range = 1 partout
  });

  it("toujours positif quand il y a du mouvement", () => {
    const n = 30;
    const highs: number[] = [];
    const lows: number[] = [];
    const closes: number[] = [];
    for (let i = 0; i < n; i++) {
      const base = 100 + i;
      highs.push(base + 2);
      lows.push(base - 2);
      closes.push(base);
    }
    const out = atr(highs, lows, closes, 14).filter((v): v is number => v !== null);
    expect(out.length).toBeGreaterThan(0);
    for (const v of out) expect(v).toBeGreaterThan(0);
  });
});
