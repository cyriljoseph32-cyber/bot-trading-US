import { describe, it, expect } from "vitest";
import { detectAll } from "./detectors";
import type { Candle } from "./strategy";

function mk(close: number, prev: number, volume = 1000): Candle {
  return {
    time: 0,
    open: prev,
    high: Math.max(close, prev) + 0.5,
    low: Math.min(close, prev) - 0.5,
    close,
    volume,
  };
}

/** Série haussière régulière de n bougies. */
function uptrend(n: number, step = 0.5, vol = 1000): Candle[] {
  const out: Candle[] = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const c = 100 + i * step;
    out.push(mk(c, i ? prev : c, vol));
    prev = c;
  }
  return out;
}

describe("detectAll", () => {
  it("renvoie 'historique insuffisant' sur série courte", () => {
    const ds = detectAll(uptrend(10));
    expect(ds).toHaveLength(6);
    expect(ds.every((d) => !d.present)).toBe(true);
  });

  it("détecte la tendance haussière sur longue série montante", () => {
    const ds = detectAll(uptrend(220));
    const trend = ds.find((d) => d.type === "tendance")!;
    expect(trend.present).toBe(true);
    expect(trend.strength).toBeGreaterThan(0);
  });

  it("détecte une cassure quand la dernière bougie passe le plus-haut récent", () => {
    const c = uptrend(220);
    // Force un nouveau plus-haut net sur la dernière bougie.
    const last = c[c.length - 1];
    last.close = last.close + 20;
    last.high = last.close + 0.5;
    const cassure = detectAll(c).find((d) => d.type === "cassure")!;
    expect(cassure.present).toBe(true);
  });

  it("détecte un volume anormal", () => {
    const c = uptrend(220, 0.5, 1000);
    c[c.length - 1].volume = 5000; // 5× la moyenne
    const vol = detectAll(c).find((d) => d.type === "volume")!;
    expect(vol.present).toBe(true);
    expect(vol.strength).toBeGreaterThan(0);
  });

  it("volume indisponible si les bougies n'ont pas de volume", () => {
    const c = uptrend(220).map((k) => ({ ...k, volume: undefined }));
    const vol = detectAll(c).find((d) => d.type === "volume")!;
    expect(vol.present).toBe(false);
    expect(vol.detail).toContain("indisponible");
  });
});
