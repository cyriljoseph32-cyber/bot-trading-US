import { describe, it, expect } from "vitest";
import { runStrategy, positionSize, PARAMS, type Candle, evaluateExit } from "./strategy";

describe("positionSize (dimensionnement par risque)", () => {
  it("risque 1% de 10000 entre entrée 100 et stop 95 → 20 actions", () => {
    // risque/action = 5 ; budget risque = 100 ; floor(100/5) = 20
    expect(positionSize(10000, 1, 100, 95)).toBe(20);
  });

  it("arrondit à l'entier inférieur (jamais de fraction d'action)", () => {
    // budget risque = 200 ; risque/action = 3 → 66.67 → 66
    expect(positionSize(20000, 1, 50, 47)).toBe(66);
  });

  it("renvoie 0 si le stop est au-dessus de l'entrée (risque non défini)", () => {
    expect(positionSize(10000, 1, 100, 105)).toBe(0);
  });

  it("renvoie 0 si capital nul ou négatif", () => {
    expect(positionSize(0, 1, 100, 95)).toBe(0);
    expect(positionSize(-5, 1, 100, 95)).toBe(0);
  });

  it("ne risque jamais plus que le budget annoncé", () => {
    const capital = 10000;
    const riskPct = 1;
    const entry = 100;
    const stop = 95;
    const qty = positionSize(capital, riskPct, entry, stop);
    const riskTaken = qty * (entry - stop);
    expect(riskTaken).toBeLessThanOrEqual((capital * riskPct) / 100);
  });
});

/* ─── Générateurs de bougies synthétiques pour la stratégie ──────────────── */

function candleFrom(time: number, close: number, prevClose: number): Candle {
  const high = Math.max(close, prevClose) + 0.5;
  const low = Math.min(close, prevClose) - 0.5;
  return { time, open: prevClose, high, low, close };
}

/** Hausse monotone (RSI(2)=100, aucune entrée) puis repli oversold PILE sur
 *  la dernière barre → l'entrée s'ouvre au dernier index, sans sortie ensuite.
 *  Avant-dernière barre : repli léger (RSI(2) reste ≥ 10, pas d'entrée). */
function uptrendThenDip(): Candle[] {
  const closes: number[] = [];
  for (let i = 0; i < 208; i++) closes.push(100 + i * 0.4); // ~100 → ~183, que des gains
  const top = closes[closes.length - 1];
  closes.push(top - 2); // repli léger : RSI(2) ≈ 17 (> seuil), pas d'entrée
  closes.push(top - 5); // repli marqué : RSI(2) < 10 → ACHETER sur la dernière barre
  const candles: Candle[] = [];
  for (let i = 0; i < closes.length; i++) {
    candles.push(candleFrom(1_000 + i * 86_400, closes[i], i ? closes[i - 1] : closes[i]));
  }
  return candles;
}

describe("runStrategy", () => {
  it("renvoie null si l'historique est insuffisant", () => {
    const short: Candle[] = Array.from({ length: 50 }, (_, i) =>
      candleFrom(i, 100 + i, 100 + i)
    );
    expect(runStrategy(short)).toBeNull();
  });

  it("déclenche ACHETER sur repli excessif en tendance haussière", () => {
    const r = runStrategy(uptrendThenDip());
    expect(r).not.toBeNull();
    expect(r!.trend).toBe("haussier");
    expect(r!.rsi2).not.toBeNull();
    expect(r!.rsi2!).toBeLessThan(PARAMS.rsiEntry);
    expect(r!.action).toBe("ACHETER");
    // Un plan d'entrée cohérent : stop strictement sous l'entrée.
    expect(r!.entryPlan).not.toBeNull();
    expect(r!.entryPlan!.stop).toBeLessThan(r!.entryPlan!.entry);
  });

  it("respecte les invariants de cohérence quel que soit l'actif", () => {
    const r = runStrategy(uptrendThenDip())!;
    // Le taux de réussite est soit null soit dans [0, 1].
    if (r.winRate !== null) {
      expect(r.winRate).toBeGreaterThanOrEqual(0);
      expect(r.winRate).toBeLessThanOrEqual(1);
    }
    // Si on VEND, une raison est fournie ; si on ACHETE, un plan existe.
    if (r.action === "VENDRE") expect(r.exitReason).not.toBeNull();
    if (r.action === "ACHETER") expect(r.entryPlan).not.toBeNull();
    // Chaque trade clôturé est auto-cohérent.
    for (const t of r.trades) {
      expect(t.exitIdx).toBeGreaterThan(t.entryIdx);
      const expectedPnl = (t.exitPrice / t.entryPrice - 1) * 100;
      expect(t.pnlPct).toBeCloseTo(expectedPnl, 6);
    }
  });
});


describe("evaluateExit (sortie sur position réelle, fix #2)", () => {
  const rising = Array.from({ length: 30 }, (_, i) => 100 + i).map((x, i) => ({
    time: i * 86400, open: x, high: x + 1, low: x - 1, close: x,
  }));
  const flat = Array.from({ length: 20 }, (_, i) => ({
    time: i * 86400, open: 100, high: 100.1, low: 99.9, close: 100,
  }));

  it("sort sur objectif quand clôture > MM5", () => {
    expect(evaluateExit(rising, { entryPrice: 110, stop: 90, daysHeld: 2 }).reason).toBe("objectif");
  });
  it("sort sur stop quand clôture <= stop", () => {
    expect(evaluateExit(rising, { entryPrice: 110, stop: 1e9, daysHeld: 2 }).reason).toBe("stop");
  });
  it("sort sur temps au-delà de maxHoldDays", () => {
    expect(evaluateExit(flat, { entryPrice: 100, stop: 90, daysHeld: 10 }).reason).toBe("temps");
  });
  it("conserve sinon", () => {
    expect(evaluateExit(flat, { entryPrice: 100, stop: 90, daysHeld: 3 }).exit).toBe(false);
  });
});
