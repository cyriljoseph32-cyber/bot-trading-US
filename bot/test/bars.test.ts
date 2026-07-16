import { describe, it, expect } from "vitest";
import { BarAggregator, type BarCloseEvent } from "../src/bars";
import type { Quote } from "../src/types";

const T0 = Date.UTC(2026, 6, 15, 15, 0, 0);

function quote(ts: number, price: number, volume: number | null = null): Quote {
  return {
    symbol: "AAPL",
    assetClass: "equity",
    exchange: "NASDAQ",
    currency: "USD",
    bid: price - 0.01,
    ask: price + 0.01,
    last: price,
    volume,
    ts,
    stale: false,
  };
}

function collector(): { events: BarCloseEvent[]; agg: BarAggregator } {
  const events: BarCloseEvent[] = [];
  const agg = new BarAggregator((e) => events.push(e));
  return { events, agg };
}

describe("BarAggregator — agrégation 1m", () => {
  it("agrège les ticks en OHLCV et clôt au changement de minute", () => {
    const { events, agg } = collector();
    agg.onQuote(quote(T0 + 1000, 100, 500));
    agg.onQuote(quote(T0 + 20_000, 102, 800));
    agg.onQuote(quote(T0 + 40_000, 99, 1200));
    agg.onQuote(quote(T0 + 61_000, 101)); // minute suivante → clôture

    const closed1m = events.filter((e) => e.bar.tf === "1m");
    expect(closed1m).toHaveLength(1);
    const bar = closed1m[0].bar;
    expect(bar.open).toBe(100);
    expect(bar.high).toBe(102);
    expect(bar.low).toBe(99);
    expect(bar.close).toBe(99);
    expect(bar.volume).toBe(1200);
    expect(bar.ticks).toBe(3);
    expect(bar.openTime).toBe(T0);
  });

  it("déduplique un tick identique (même ts, même prix)", () => {
    const { agg } = collector();
    agg.onQuote(quote(T0 + 1000, 100));
    agg.onQuote(quote(T0 + 1000, 100)); // doublon exact
    agg.onQuote(quote(T0 + 61_000, 101));
    const [bar] = agg.getBars("AAPL", "1m");
    expect(bar.ticks).toBe(1);
  });

  it("marque gapBefore après un trou de données", () => {
    const { events, agg } = collector();
    agg.onQuote(quote(T0 + 1000, 100));
    agg.onQuote(quote(T0 + 3 * 60_000 + 1000, 101)); // saute 2 minutes
    agg.onQuote(quote(T0 + 4 * 60_000 + 1000, 102));
    const bars1m = events.filter((e) => e.bar.tf === "1m").map((e) => e.bar);
    expect(bars1m[1]?.gapBefore).toBe(true);
  });

  it("ignore un tick en retard sur une bougie déjà close", () => {
    const { agg } = collector();
    agg.onQuote(quote(T0 + 1000, 100));
    agg.onQuote(quote(T0 + 61_000, 101));
    agg.onQuote(quote(T0 + 2000, 500)); // retardataire de la minute close
    expect(agg.getBars("AAPL", "1m")).toHaveLength(1);
    expect(agg.getBars("AAPL", "1m")[0].high).toBe(100);
  });
});

describe("BarAggregator — aberrations et roll-ups", () => {
  it("signale une variation aberrante (>10% actions) et l'exclut de getBars", () => {
    const { agg } = collector();
    agg.onQuote(quote(T0 + 1000, 100));
    agg.onQuote(quote(T0 + 61_000, 150)); // +50% en 1 minute → clôt la 1re, ouvre l'aberrante
    agg.onQuote(quote(T0 + 121_000, 100)); // clôt l'aberrante

    const all = agg.getBars("AAPL", "1m", true);
    const clean = agg.getBars("AAPL", "1m");
    expect(all).toHaveLength(2);
    expect(all[1].outlier).toBe(true);
    expect(clean).toHaveLength(1);
  });

  it("produit aussi des bougies 5m et 15m", () => {
    const { events, agg } = collector();
    for (let m = 0; m <= 15; m++) {
      agg.onQuote(quote(T0 + m * 60_000 + 500, 100 + m * 0.1));
    }
    expect(events.some((e) => e.bar.tf === "5m")).toBe(true);
    expect(events.some((e) => e.bar.tf === "15m")).toBe(true);
    const bar5 = events.find((e) => e.bar.tf === "5m")!.bar;
    expect(bar5.openTime).toBe(T0);
    expect(bar5.close).toBeCloseTo(100.4, 10); // dernier tick de la fenêtre 0-4 min
  });

  it("flushExpired clôt les bougies expirées sans nouveau tick", () => {
    const { events, agg } = collector();
    agg.onQuote(quote(T0 + 1000, 100));
    expect(events).toHaveLength(0);
    agg.flushExpired(T0 + 16 * 60_000, () => "equity");
    expect(events.filter((e) => e.bar.tf === "1m")).toHaveLength(1);
    expect(events.filter((e) => e.bar.tf === "15m")).toHaveLength(1);
  });

  it("seed() amorce l'historique et déduplique par openTime", () => {
    const { agg } = collector();
    const bar = {
      symbol: "AAPL", tf: "15m" as const, openTime: T0,
      open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, ticks: 0,
    };
    agg.seed([bar, { ...bar }]);
    expect(agg.getBars("AAPL", "15m")).toHaveLength(1);
  });
});
