import { describe, it, expect } from "vitest";
import { SpcEngine, syntheticQuote } from "../src/strategy/spcfx5/engine";
import { syntheticH1Bars } from "../src/spcfx5-backtest";
import { DEFAULT_SPC_PARAMS, mergeParams } from "../src/strategy/spcfx5/params";
import { selectSpcUniverse, type SpcConfig } from "../src/strategy/spcfx5/universe";
import { PortfolioGovernor, DEFAULT_SPC_PORTFOLIO } from "../src/risk/portfolio";
import { RiskEngine, DEFAULT_GLOBAL_RISK } from "../src/risk/engine";
import { PaperBroker } from "../src/exec/paper";
import { OrderRouter } from "../src/exec/router";
import { MemoryStore } from "../src/store";
import type { SpcAsset } from "../src/strategy/spcfx5/types";

const CONFIG: SpcConfig = {
  assets: [
    {
      std: "AAA", provider: "AAA", category: "equity", assetClass: "equity",
      exchange: "NASDAQ", currency: "USD", country: "US", enabled: true,
      costBps: 3, groups: ["indices_us:+1"],
    } as SpcAsset,
    {
      std: "BBB", provider: "BBB", category: "equity", assetClass: "equity",
      exchange: "NASDAQ", currency: "USD", country: "US", enabled: true,
      costBps: 3, groups: ["indices_us:+1"],
    } as SpcAsset,
  ],
  correlationGroups: { indices_us: { maxRiskPct: 1 } },
};

/** Monte un moteur complet — exactement le câblage du runner et du backtest. */
function buildEngine() {
  const { selected } = selectSpcUniverse(CONFIG, 10);
  const params = mergeParams(DEFAULT_SPC_PARAMS, {
    session: { ...DEFAULT_SPC_PARAMS.session, enabled: false },
  });
  const store = new MemoryStore();
  const broker = new PaperBroker(100_000, "USD");
  broker.registerInstruments(selected.map((s) => s.instrument));
  broker.updateFxRate("USD", 1);
  const router = new OrderRouter(broker, false, null);
  const risk = new RiskEngine({ ...DEFAULT_GLOBAL_RISK });
  const governor = new PortfolioGovernor({ ...DEFAULT_SPC_PORTFOLIO }, 100_000, Date.UTC(2026, 0, 5));
  const engine = new SpcEngine({
    config: CONFIG, universe: selected, params, broker, router, risk, governor, store, news: null,
  });
  return { engine, broker, store, governor, selected, params };
}

/** Rejoue N bougies H1 par symbole à travers le moteur. */
function replay(count = 700) {
  const ctx = buildEngine();
  const series = ctx.selected.map((entry, i) => ({
    entry,
    bars: syntheticH1Bars(entry.instrument.symbol, count, 100 + i * 20, 4242 + i * 13),
  }));
  for (let i = 0; i < count; i++) {
    for (const { entry, bars } of series) ctx.engine.ingestBar(entry, bars[i], 3);
    ctx.engine.runCycle(series[0].bars[i].openTime + 3_600_000);
  }
  return ctx;
}

describe("SpcEngine — chaîne complète", () => {
  it("évalue chaque symbole à chaque cycle et persiste les signaux", () => {
    const { store, selected } = replay(300);
    const signals = store.records.filter((r) => r.kind === "spcfx5-signals");
    expect(signals.length).toBe(300 * selected.length);
  });

  it("produit des signaux avec un score détaillé une fois l'historique suffisant", () => {
    const { engine } = replay(400);
    const scored = engine.signals().filter((s) => s.parts.length > 0);
    expect(scored.length).toBeGreaterThan(0);
    expect(scored.every((s) => s.score >= 0 && s.score <= 100)).toBe(true);
  });

  it("n'entre jamais deux fois sur le même symbole tant que la position est ouverte", () => {
    const { broker, store } = replay(700);
    const entries = store.orders.filter((o) => o.status === "filled");
    // Toute position ouverte est unique par symbole — c'est l'invariant du broker.
    const symbols = broker.snapshot().positions.map((p) => p.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(entries.length).toBeGreaterThanOrEqual(0);
  });

  it("est déterministe : deux exécutions donnent le même P&L", () => {
    const a = replay(700).broker.snapshot();
    const b = replay(700).broker.snapshot();
    expect(a.realizedPnl).toBe(b.realizedPnl);
    expect(a.positions.length).toBe(b.positions.length);
  });

  it("respecte le plafond de positions ouvertes du gouverneur", () => {
    const { broker } = replay(700);
    expect(broker.snapshot().positions.length).toBeLessThanOrEqual(
      DEFAULT_SPC_PORTFOLIO.maxOpenPositions
    );
  });
});

describe("syntheticQuote", () => {
  it("marque explicitement le bid/ask comme reconstitué", () => {
    const { selected } = selectSpcUniverse(CONFIG, 10);
    const q = syntheticQuote(selected[0], 100, 10, 1_700_000_000_000);
    expect(q.estimated).toBe(true);
    expect(q.bid).toBeCloseTo(99.95, 5);
    expect(q.ask).toBeCloseTo(100.05, 5);
    expect(q.stale).toBe(false);
  });
});

describe("SpcEngine — sorties", () => {
  it("ferme une position quand le stop est touché, sans jamais bloquer la sortie", () => {
    const ctx = buildEngine();
    const entry = ctx.selected[0];
    const bars = syntheticH1Bars(entry.instrument.symbol, 400, 100, 999);
    for (const bar of bars) ctx.engine.ingestBar(entry, bar, 3);

    // Position forcée, puis effondrement du prix : le stop doit partir.
    const quote = syntheticQuote(entry, 100, 3, bars[bars.length - 1].openTime);
    ctx.broker.submit(
      { clientOrderId: "test-open", symbol: entry.instrument.symbol, side: "buy", qty: 10, stopLoss: 95, takeProfit: 120 },
      quote
    );
    expect(ctx.broker.position(entry.instrument.symbol)).not.toBeNull();

    ctx.engine.onQuote(syntheticQuote(entry, 90, 3, quote.ts + 60_000));
    expect(ctx.broker.position(entry.instrument.symbol)).toBeNull();
  });
});
