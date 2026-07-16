import { describe, it, expect } from "vitest";
import { isExchangeOpen, isFxOpen, isMarketOpen, isStale } from "../src/sessions";

// 2026-07-15 est un mercredi ; 2026-07-18 un samedi ; 2026-07-19 un dimanche.
const WED = (h: number, m = 0) => Date.UTC(2026, 6, 15, h, m);
const SAT = (h: number) => Date.UTC(2026, 6, 18, h);
const SUN = (h: number) => Date.UTC(2026, 6, 19, h);

describe("sessions actions", () => {
  it("NYSE ouvert mercredi 15h UTC, fermé 22h UTC et le samedi", () => {
    expect(isExchangeOpen("NYSE", WED(15))).toBe(true);
    expect(isExchangeOpen("NYSE", WED(22))).toBe(false);
    expect(isExchangeOpen("NYSE", SAT(15))).toBe(false);
  });

  it("Tokyo : pause déjeuner 02:30–03:30 UTC fermée, matin et après-midi ouverts", () => {
    expect(isExchangeOpen("TSE", WED(1))).toBe(true);
    expect(isExchangeOpen("TSE", WED(3, 0))).toBe(false);
    expect(isExchangeOpen("TSE", WED(4))).toBe(true);
    expect(isExchangeOpen("TSE", WED(7))).toBe(false);
  });

  it("Londres ouvert 9h UTC, fermé 17h UTC", () => {
    expect(isExchangeOpen("LSE", WED(9))).toBe(true);
    expect(isExchangeOpen("LSE", WED(17))).toBe(false);
  });
});

describe("sessions FX", () => {
  it("fermé le samedi, réouvre dimanche 21h UTC, ferme vendredi 22h UTC", () => {
    expect(isFxOpen(SAT(12))).toBe(false);
    expect(isFxOpen(SUN(20))).toBe(false);
    expect(isFxOpen(SUN(22))).toBe(true);
    expect(isFxOpen(Date.UTC(2026, 6, 17, 21))).toBe(true); // vendredi 21h
    expect(isFxOpen(Date.UTC(2026, 6, 17, 23))).toBe(false); // vendredi 23h
    expect(isFxOpen(WED(3))).toBe(true);
  });
});

describe("isMarketOpen / isStale", () => {
  it("crypto toujours ouvert", () => {
    expect(isMarketOpen("crypto", "CRYPTO", SAT(3))).toBe(true);
  });

  it("cotation vieille de 3 min en séance → stale ; marché fermé → jamais stale", () => {
    const now = WED(15);
    expect(isStale("equity", "NYSE", now - 180_000, now)).toBe(true);
    expect(isStale("equity", "NYSE", now - 30_000, now)).toBe(false);
    const closed = SAT(15);
    expect(isStale("equity", "NYSE", closed - 86_400_000, closed)).toBe(false);
  });

  it("FX : stale après 60s en session", () => {
    const now = WED(10);
    expect(isStale("fx", "FOREX", now - 90_000, now)).toBe(true);
    expect(isStale("fx", "FOREX", now - 30_000, now)).toBe(false);
  });
});
