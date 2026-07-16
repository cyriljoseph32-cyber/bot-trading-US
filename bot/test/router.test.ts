import { describe, it, expect } from "vitest";
import { OrderRouter } from "../src/exec/router";
import { PaperBroker } from "../src/exec/paper";
import type { BrokerAdapter } from "../src/exec/broker";
import type { Instrument, OrderResult, Quote } from "../src/types";

const AAPL: Instrument = {
  symbol: "AAPL", assetClass: "equity", exchange: "NASDAQ",
  currency: "USD", country: "US", region: "us",
};

const quote: Quote = {
  symbol: "AAPL", assetClass: "equity", exchange: "NASDAQ", currency: "USD",
  bid: 99.95, ask: 100.05, last: 100, volume: 1e6, ts: Date.now(), stale: false,
};

function paper(): PaperBroker {
  const b = new PaperBroker(100_000, "USD");
  b.registerInstruments([AAPL]);
  return b;
}

/** Faux adaptateur réel : trace les appels au lieu d'envoyer des ordres. */
function fakeLive(): BrokerAdapter & { calls: number } {
  const adapter = {
    name: "fake-live",
    isLive: true,
    calls: 0,
    submit(): OrderResult {
      adapter.calls += 1;
      return { clientOrderId: "x", status: "filled", ts: Date.now() };
    },
    snapshot: () => paper().snapshot(),
  };
  return adapter;
}

const order = { clientOrderId: "r1", symbol: "AAPL", side: "buy" as const, qty: 1 };

describe("OrderRouter — garde du trading réel", () => {
  it("LIVE_TRADING absent → paper, même avec un adaptateur réel branché", () => {
    const live = fakeLive();
    const router = new OrderRouter(paper(), false, live);
    expect(router.isLive()).toBe(false);
    router.submit(order, quote);
    expect(live.calls).toBe(0);
  });

  it("LIVE_TRADING=true SANS adaptateur → paper (jamais de réel implicite)", () => {
    const p = paper();
    const router = new OrderRouter(p, true, null);
    expect(router.isLive()).toBe(false);
    const res = router.submit(order, quote);
    expect(res.status).toBe("filled");
    expect(p.snapshot().positions).toHaveLength(1); // exécuté en papier
  });

  it("réel UNIQUEMENT si LIVE_TRADING=true ET adaptateur réel fourni", () => {
    const live = fakeLive();
    const router = new OrderRouter(paper(), true, live);
    expect(router.isLive()).toBe(true);
    router.submit(order, quote);
    expect(live.calls).toBe(1);
  });
});
