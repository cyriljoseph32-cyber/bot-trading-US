import { describe, it, expect } from "vitest";
import { RiskEngine, DEFAULT_GLOBAL_RISK, type EntryContext } from "../src/risk/engine";
import type { Instrument, PortfolioSnapshot, Position, Quote } from "../src/types";

const AAPL: Instrument = {
  symbol: "AAPL", assetClass: "equity", exchange: "NASDAQ",
  currency: "USD", country: "US", sector: "tech", region: "us",
};

function quote(over: Partial<Quote> = {}): Quote {
  return {
    symbol: "AAPL", assetClass: "equity", exchange: "NASDAQ", currency: "USD",
    bid: 99.95, ask: 100.05, last: 100, volume: 1e6, ts: Date.now(), stale: false,
    ...over,
  };
}

function portfolio(over: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    baseCurrency: "USD", equity: 100_000, cash: 100_000,
    dayStartEquity: 100_000, realizedPnl: 0, unrealizedPnl: 0, positions: [],
    ...over,
  };
}

function position(over: Partial<Position> = {}): Position {
  return {
    symbol: "X", assetClass: "equity", currency: "USD", country: "US",
    sector: "tech", qty: 100, avgEntryPrice: 100, openedAt: 0,
    ...over,
  };
}

const usdToBase = (ccy: string, amount: number) => (ccy === "USD" ? amount : null);

function ctx(over: Partial<EntryContext> = {}): EntryContext {
  return {
    instrument: AAPL, quote: quote(), atr: 2, side: "buy",
    portfolio: portfolio(), fxToBase: usdToBase,
    ...over,
  };
}

function engine(overrides = {}): RiskEngine {
  return new RiskEngine({ ...DEFAULT_GLOBAL_RISK, ...overrides });
}

describe("RiskEngine — sizing par volatilité", () => {
  it("qty = budget de risque / distance de stop, stop et TP attachés", () => {
    const d = engine().evaluateEntry(ctx());
    // risque 0.5% de 100k = 500 ; stop = 2×ATR = 4 → 125, plafonné à 10% equity/prix = 100.
    expect(d.approved).toBe(true);
    expect(d.qty).toBe(100);
    expect(d.stopLoss).toBe(96); // 100 − 4
    expect(d.takeProfit).toBe(108); // 100 + 4×2R
  });

  it("côté vendeur : stop au-dessus, TP en dessous", () => {
    const d = engine().evaluateEntry(ctx({ side: "sell" }));
    expect(d.stopLoss).toBe(104);
    expect(d.takeProfit).toBe(92);
  });

  it("ATR manquant ou nul → stop_invalid", () => {
    expect(engine().evaluateEntry(ctx({ atr: null })).rejects).toContain("stop_invalid");
    expect(engine().evaluateEntry(ctx({ atr: 0 })).rejects).toContain("stop_invalid");
  });
});

describe("RiskEngine — rejets", () => {
  it("kill switch bloque toute entrée", () => {
    const d = engine({ killSwitch: true }).evaluateEntry(ctx());
    expect(d.approved).toBe(false);
    expect(d.rejects).toContain("kill_switch");
  });

  it("perte quotidienne au-delà du plafond", () => {
    const d = engine().evaluateEntry(
      ctx({ portfolio: portfolio({ equity: 97_000 }) }) // −3% vs plafond 2%
    );
    expect(d.rejects).toContain("daily_loss");
  });

  it("cotation stale refusée", () => {
    const d = engine().evaluateEntry(ctx({ quote: quote({ stale: true }) }));
    expect(d.rejects).toContain("stale_quote");
  });

  it("spread trop large refusé", () => {
    const d = engine().evaluateEntry(ctx({ quote: quote({ bid: 99, ask: 101 }) })); // 200 bps
    expect(d.rejects).toContain("spread_too_wide");
  });

  it("exposition brute au plafond → gross_exposure", () => {
    const positions = [position({ qty: 600, avgEntryPrice: 100 })]; // 60 000 = 60%
    const d = engine().evaluateEntry(ctx({ portfolio: portfolio({ positions }) }));
    expect(d.rejects).toContain("gross_exposure");
  });

  it("exposition pays au plafond → country_exposure", () => {
    const positions = [position({ country: "US", qty: 250, avgEntryPrice: 100 })]; // 25%
    const d = engine().evaluateEntry(ctx({ portfolio: portfolio({ positions }) }));
    expect(d.rejects).toContain("country_exposure");
  });

  it("exposition secteur au plafond → sector_exposure", () => {
    const positions = [position({ country: "JP", sector: "tech", qty: 250, avgEntryPrice: 100 })];
    const d = engine().evaluateEntry(ctx({ portfolio: portfolio({ positions }) }));
    expect(d.rejects).toContain("sector_exposure");
  });

  it("exposition devise (hors base) au plafond → currency_exposure", () => {
    const eurInst: Instrument = { ...AAPL, symbol: "MC", currency: "EUR", country: "FR", sector: "consumer" };
    const fx = (ccy: string, amount: number) => (ccy === "EUR" ? amount * 1.1 : amount);
    const positions = [position({ symbol: "SAP", currency: "EUR", country: "DE", sector: "tech", qty: 273, avgEntryPrice: 100 })]; // ~30%
    const d = engine().evaluateEntry(
      ctx({
        instrument: eurInst,
        quote: quote({ symbol: "MC", currency: "EUR" }),
        portfolio: portfolio({ positions }),
        fxToBase: fx,
      })
    );
    expect(d.rejects).toContain("currency_exposure");
  });

  it("capital insuffisant pour 1 unité → insufficient_capital", () => {
    const d = engine().evaluateEntry(
      ctx({ portfolio: portfolio({ equity: 50, cash: 50, dayStartEquity: 50 }), atr: 2 })
    );
    expect(d.rejects).toContain("insufficient_capital");
  });
});

describe("RiskEngine — disjoncteur et sorties", () => {
  it("s'ouvre après N échecs consécutifs et bloque les entrées", () => {
    const e = engine({ circuitBreakerThreshold: 3 });
    e.recordFailure();
    e.recordFailure();
    expect(e.isCircuitOpen()).toBe(false);
    e.recordFailure();
    expect(e.isCircuitOpen()).toBe(true);
    expect(e.evaluateEntry(ctx()).rejects).toContain("circuit_breaker");
    e.resetCircuit();
    expect(e.evaluateEntry(ctx()).approved).toBe(true);
  });

  it("un succès réarme le compteur d'échecs", () => {
    const e = engine({ circuitBreakerThreshold: 2 });
    e.recordFailure();
    e.recordSuccess();
    e.recordFailure();
    expect(e.isCircuitOpen()).toBe(false);
  });

  it("les sorties ne sont jamais bloquées", () => {
    const e = engine({ killSwitch: true });
    expect(e.evaluateExit().approved).toBe(true);
  });
});
