import { describe, it, expect } from "vitest";
import { parseTdMessage, parseTdTimeSeries } from "../src/provider/twelvedata";
import type { Instrument } from "../src/types";

const AAPL: Instrument = {
  symbol: "AAPL",
  assetClass: "equity",
  exchange: "NASDAQ",
  currency: "USD",
  country: "US",
  region: "us",
};
const instruments = new Map([["AAPL", AAPL]]);

// Mercredi 15:00 UTC — NASDAQ ouvert.
const NOW = Date.UTC(2026, 6, 15, 15, 0, 0);

describe("parseTdMessage", () => {
  it("normalise un événement price complet", () => {
    const raw = JSON.stringify({
      event: "price",
      symbol: "AAPL",
      price: 211.5,
      bid: 211.4,
      ask: 211.6,
      day_volume: 1000000,
      timestamp: Math.floor(NOW / 1000) - 5,
    });
    const parsed = parseTdMessage(raw, instruments, NOW);
    expect(parsed.kind).toBe("quote");
    if (parsed.kind !== "quote") return;
    expect(parsed.quote.symbol).toBe("AAPL");
    expect(parsed.quote.last).toBe(211.5);
    expect(parsed.quote.bid).toBe(211.4);
    expect(parsed.quote.ask).toBe(211.6);
    expect(parsed.quote.volume).toBe(1000000);
    expect(parsed.quote.currency).toBe("USD");
    expect(parsed.quote.ts).toBe((Math.floor(NOW / 1000) - 5) * 1000); // secondes → ms
    expect(parsed.quote.stale).toBe(false);
  });

  it("marque stale une cotation trop vieille en séance", () => {
    const raw = JSON.stringify({
      event: "price",
      symbol: "AAPL",
      price: 211.5,
      timestamp: Math.floor(NOW / 1000) - 600, // 10 min
    });
    const parsed = parseTdMessage(raw, instruments, NOW);
    expect(parsed.kind).toBe("quote");
    if (parsed.kind === "quote") expect(parsed.quote.stale).toBe(true);
  });

  it("bid/ask absents ou nuls → null (pas de fausse cotation)", () => {
    const raw = JSON.stringify({ event: "price", symbol: "AAPL", price: 211.5, bid: 0 });
    const parsed = parseTdMessage(raw, instruments, NOW);
    if (parsed.kind === "quote") {
      expect(parsed.quote.bid).toBeNull();
      expect(parsed.quote.ask).toBeNull();
    } else expect.fail("quote attendue");
  });

  it("ignore : symbole inconnu, prix invalide, JSON cassé", () => {
    expect(parseTdMessage(JSON.stringify({ event: "price", symbol: "ZZZZ", price: 5 }), instruments, NOW).kind).toBe("ignored");
    expect(parseTdMessage(JSON.stringify({ event: "price", symbol: "AAPL", price: -3 }), instruments, NOW).kind).toBe("ignored");
    expect(parseTdMessage(JSON.stringify({ event: "price", symbol: "AAPL" }), instruments, NOW).kind).toBe("ignored");
    expect(parseTdMessage("{pas du json", instruments, NOW).kind).toBe("ignored");
  });

  it("reconnaît heartbeat et subscribe-status", () => {
    expect(parseTdMessage(JSON.stringify({ event: "heartbeat" }), instruments, NOW).kind).toBe("heartbeat");
    expect(parseTdMessage(JSON.stringify({ event: "subscribe-status", status: "ok" }), instruments, NOW).kind).toBe("status");
  });
});

describe("parseTdTimeSeries", () => {
  it("convertit et trie les bougies par openTime croissant", () => {
    const bars = parseTdTimeSeries(
      {
        values: [
          { datetime: "2026-07-15 15:15:00", open: "211", high: "212", low: "210.5", close: "211.8", volume: "5000" },
          { datetime: "2026-07-15 15:00:00", open: "210", high: "211.2", low: "209.9", close: "211", volume: "8000" },
        ],
      },
      "AAPL",
      "15m"
    );
    expect(bars).toHaveLength(2);
    expect(bars[0].openTime).toBe(Date.UTC(2026, 6, 15, 15, 0, 0));
    expect(bars[1].openTime).toBe(Date.UTC(2026, 6, 15, 15, 15, 0));
    expect(bars[0].close).toBe(211);
    expect(bars[1].volume).toBe(5000);
  });

  it("réponse en erreur → exception explicite", () => {
    expect(() => parseTdTimeSeries({ status: "error", message: "quota" }, "AAPL", "1m")).toThrow(/quota/);
  });
});
