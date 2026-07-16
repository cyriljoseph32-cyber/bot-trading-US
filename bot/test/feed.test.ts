import { describe, it, expect } from "vitest";
import { backoffDelayMs, chunkSymbols, HeartbeatMonitor, RateLimiter } from "../src/feed";

describe("backoffDelayMs", () => {
  const opts = { baseMs: 1000, maxMs: 60_000, jitter: 0 };

  it("double à chaque tentative", () => {
    expect(backoffDelayMs(0, opts)).toBe(1000);
    expect(backoffDelayMs(1, opts)).toBe(2000);
    expect(backoffDelayMs(3, opts)).toBe(8000);
  });

  it("plafonne au maximum", () => {
    expect(backoffDelayMs(10, opts)).toBe(60_000);
    expect(backoffDelayMs(30, opts)).toBe(60_000);
  });

  it("applique le jitter", () => {
    const withJitter = { ...opts, jitter: 0.2 };
    expect(backoffDelayMs(0, withJitter, () => 1)).toBe(1200);
    expect(backoffDelayMs(0, withJitter, () => 0)).toBe(1000);
  });
});

describe("HeartbeatMonitor", () => {
  it("détecte un flux mort après le timeout", () => {
    const m = new HeartbeatMonitor(100, 1000);
    expect(m.isDead(1050)).toBe(false);
    expect(m.isDead(1150)).toBe(true);
  });

  it("touch() réarme le compteur", () => {
    const m = new HeartbeatMonitor(100, 1000);
    m.touch(1090);
    expect(m.isDead(1150)).toBe(false);
    expect(m.msSinceLastEvent(1150)).toBe(60);
  });
});

describe("chunkSymbols", () => {
  it("découpe en lots de la taille demandée", () => {
    expect(chunkSymbols(["A", "B", "C", "D", "E"], 2)).toEqual([["A", "B"], ["C", "D"], ["E"]]);
  });

  it("liste vide → aucun lot", () => {
    expect(chunkSymbols([], 10)).toEqual([]);
  });
});

describe("RateLimiter", () => {
  it("accorde jusqu'au quota puis refuse avec un délai", () => {
    const rl = new RateLimiter(2, 0);
    expect(rl.tryAcquire(10).ok).toBe(true);
    expect(rl.tryAcquire(20).ok).toBe(true);
    const third = rl.tryAcquire(30);
    expect(third.ok).toBe(false);
    expect(third.retryInMs).toBe(60_000 - 30);
  });

  it("recharge après une minute", () => {
    const rl = new RateLimiter(1, 0);
    expect(rl.tryAcquire(0).ok).toBe(true);
    expect(rl.tryAcquire(59_999).ok).toBe(false);
    expect(rl.tryAcquire(60_000).ok).toBe(true);
  });
});
