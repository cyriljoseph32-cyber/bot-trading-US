import { describe, it, expect } from "vitest";
import { PaperBroker } from "../src/exec/paper";
import type { Instrument, OrderRequest, Quote } from "../src/types";

const AAPL: Instrument = {
  symbol: "AAPL", assetClass: "equity", exchange: "NASDAQ",
  currency: "USD", country: "US", sector: "tech", region: "us",
};
const SONY: Instrument = {
  symbol: "6758", assetClass: "equity", exchange: "TSE",
  currency: "JPY", country: "JP", sector: "tech", region: "japan",
};

function quote(symbol: string, price: number, over: Partial<Quote> = {}): Quote {
  return {
    symbol, assetClass: "equity", exchange: "NASDAQ", currency: "USD",
    bid: price - 0.05, ask: price + 0.05, last: price, volume: 1e6,
    ts: Date.now(), stale: false,
    ...over,
  };
}

function order(over: Partial<OrderRequest> = {}): OrderRequest {
  return { clientOrderId: "o1", symbol: "AAPL", side: "buy", qty: 10, ...over };
}

function broker(costs = { feeBps: 0, slippageBps: 0 }): PaperBroker {
  const b = new PaperBroker(100_000, "USD", costs);
  b.registerInstruments([AAPL, SONY]);
  return b;
}

describe("PaperBroker — idempotence", () => {
  it("rejouer le même clientOrderId ne crée pas de second ordre", () => {
    const b = broker();
    const q = quote("AAPL", 100);
    const first = b.submit(order(), q);
    const replay = b.submit(order(), q);
    expect(first.status).toBe("filled");
    expect(replay.status).toBe("duplicate");
    expect(replay.fillPrice).toBe(first.fillPrice);
    // Une seule position de 10, pas 20.
    expect(b.snapshot().positions[0].qty).toBe(10);
  });

  it("un ordre rejeté est aussi mémorisé (pas de retry silencieux)", () => {
    const b = broker();
    const stale = quote("AAPL", 100, { stale: true });
    expect(b.submit(order(), stale).status).toBe("rejected");
    expect(b.submit(order(), quote("AAPL", 100)).status).toBe("duplicate");
  });
});

describe("PaperBroker — exécution et coûts", () => {
  it("achète à l'ask + slippage, vend au bid − slippage", () => {
    const b = broker({ feeBps: 0, slippageBps: 10 });
    const q = quote("AAPL", 100); // ask 100.05
    const res = b.submit(order(), q);
    expect(res.fillPrice).toBeCloseTo(100.05 * 1.001, 3);
  });

  it("rejette : qty invalide, cotation stale, cash insuffisant", () => {
    const b = broker();
    expect(b.submit(order({ qty: 0 }), quote("AAPL", 100)).reason).toBe("qty_invalid");
    expect(b.submit(order({ clientOrderId: "o2", qty: 5 }), quote("AAPL", 100, { stale: true })).reason).toBe("stale_quote");
    expect(b.submit(order({ clientOrderId: "o3", qty: 10_000 }), quote("AAPL", 100)).reason).toBe("insufficient_cash");
  });

  it("P&L réalisé à la clôture, frais déduits", () => {
    const b = broker({ feeBps: 10, slippageBps: 0 });
    b.submit(order({ qty: 100 }), quote("AAPL", 100, { bid: 100, ask: 100 }));
    b.updateQuote(quote("AAPL", 110, { bid: 110, ask: 110 }));
    b.submit(order({ clientOrderId: "o2", side: "sell", qty: 100 }), quote("AAPL", 110, { bid: 110, ask: 110 }));
    const snap = b.snapshot();
    // Gain brut 1000 ; frais vente 0.1% de 11000 = 11 → 989.
    expect(snap.realizedPnl).toBeCloseTo(989, 0);
    expect(snap.positions).toHaveLength(0);
  });
});

describe("PaperBroker — conversion FX", () => {
  it("valorise une position JPY en devise de base via le taux du flux", () => {
    const b = broker();
    b.updateFxRate("JPY", 0.0068); // 1 JPY = 0.0068 USD
    const q = quote("6758", 15_000, { currency: "JPY", bid: 15_000, ask: 15_000 });
    const res = b.submit(order({ symbol: "6758", qty: 10 }), q);
    expect(res.status).toBe("filled");
    // Notionnel : 150 000 JPY = 1 020 USD débités du cash.
    expect(b.snapshot().cash).toBeCloseTo(100_000 - 1020, 0);
    // Le prix monte de 1 000 JPY → P&L latent = 10 000 JPY = 68 USD.
    b.updateQuote(quote("6758", 16_000, { currency: "JPY" }));
    expect(b.snapshot().unrealizedPnl).toBeCloseTo(68, 0);
  });

  it("refuse d'exécuter sans taux de conversion connu", () => {
    const b = broker();
    const q = quote("6758", 15_000, { currency: "JPY" });
    expect(b.submit(order({ symbol: "6758", qty: 1 }), q).reason).toBe("fx_rate_unknown");
  });
});

describe("PaperBroker — stops et take-profits", () => {
  it("checkExit déclenche la sortie quand le stop est touché", () => {
    const b = broker();
    b.submit(order({ qty: 10, stopLoss: 95, takeProfit: 110 }), quote("AAPL", 100));
    expect(b.checkExit(quote("AAPL", 97))).toBeNull();
    const exitOrder = b.checkExit(quote("AAPL", 94.5));
    expect(exitOrder).not.toBeNull();
    expect(exitOrder!.side).toBe("sell");
    expect(exitOrder!.qty).toBe(10);
    expect(exitOrder!.clientOrderId).toContain("sl");
  });

  it("checkExit déclenche la sortie au take-profit", () => {
    const b = broker();
    b.submit(order({ qty: 10, stopLoss: 95, takeProfit: 110 }), quote("AAPL", 100));
    const exitOrder = b.checkExit(quote("AAPL", 111));
    expect(exitOrder!.clientOrderId).toContain("tp");
  });

  it("rollDay fige la base du P&L quotidien", () => {
    const b = broker();
    b.submit(order({ qty: 100 }), quote("AAPL", 100, { bid: 100, ask: 100 }));
    b.updateQuote(quote("AAPL", 105));
    b.rollDay();
    expect(b.snapshot().dayStartEquity).toBe(b.snapshot().equity);
  });
});
