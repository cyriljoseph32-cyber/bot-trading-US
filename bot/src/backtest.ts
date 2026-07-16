/* ─── Backtest — MÊME pipeline et MÊME moteur de risque que le temps réel ──
 *
 * Rejoue des bougies (JSONL persisté par le bot, ou échantillon synthétique
 * généré si aucun fichier n'est fourni) à travers evaluate() + RiskEngine +
 * PaperBroker — exactement le code du mode paper. Coûts, slippage et
 * conversion FX inclus via PaperBroker.
 *
 * ⚠ BIAIS DU SURVIVANT : un backtest sur l'univers ACTUEL surestime la
 * performance — les titres retirés de la cote ou devenus illiquides n'y
 * figurent plus. Les résultats sont indicatifs, jamais des promesses.
 *
 * Usage : npm run bot:backtest [-- chemin/vers/bars.jsonl]
 */

import { readFileSync, existsSync } from "node:fs";
import type { Bar, Instrument, Quote } from "./types";
import { evaluate, detectRegime, type Regime } from "./strategy/pipeline";
import { RiskEngine, DEFAULT_GLOBAL_RISK } from "./risk/engine";
import { PaperBroker } from "./exec/paper";
import { OrderRouter } from "./exec/router";
import { atr } from "../../src/trading/indicators";

const BASE = "USD";
const SCORE_ENTRY = 70;

/** Génère un échantillon synthétique (marche aléatoire, graine fixe). */
export function syntheticBars(symbol: string, count: number, startPrice: number, seed: number): Bar[] {
  let s = seed;
  const rand = () => {
    // LCG déterministe — reproductible sans dépendance.
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const bars: Bar[] = [];
  let price = startPrice;
  const t0 = Date.UTC(2026, 0, 5, 14, 0, 0);
  for (let i = 0; i < count; i++) {
    const drift = 0.0001;
    const shock = (rand() - 0.5) * 0.004;
    const open = price;
    price = Math.max(0.01, price * (1 + drift + shock));
    const high = Math.max(open, price) * (1 + rand() * 0.001);
    const low = Math.min(open, price) * (1 - rand() * 0.001);
    bars.push({
      symbol,
      tf: "15m",
      openTime: t0 + i * 900_000,
      open,
      high,
      low,
      close: price,
      volume: Math.round(1e5 + rand() * 1e6),
      ticks: 0,
    });
  }
  return bars;
}

function loadBars(path: string): Bar[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Bar)
    .filter((b) => b.tf === "15m")
    .sort((a, b) => a.openTime - b.openTime);
}

function quoteFromBar(bar: Bar, inst: Instrument): Quote {
  const half = bar.close * 0.0002; // spread synthétique 4 bps
  return {
    symbol: bar.symbol,
    assetClass: inst.assetClass,
    exchange: inst.exchange,
    currency: inst.currency,
    bid: bar.close - half,
    ask: bar.close + half,
    last: bar.close,
    volume: bar.volume,
    ts: bar.openTime + 900_000,
    stale: false,
  };
}

export interface BacktestResult {
  finalEquity: number;
  returnPct: number;
  trades: number;
  rejects: number;
}

export function runBacktest(barsBySymbol: Map<string, Bar[]>, benchmarkSymbol: string): BacktestResult {
  const instruments = new Map<string, Instrument>();
  for (const symbol of barsBySymbol.keys()) {
    instruments.set(symbol, {
      symbol,
      assetClass: "equity",
      exchange: "NYSE",
      currency: BASE,
      country: "US",
      sector: "tech",
      region: "us",
    });
  }

  const broker = new PaperBroker(100_000, BASE);
  broker.registerInstruments([...instruments.values()]);
  const router = new OrderRouter(broker, false); // backtest = jamais réel
  const risk = new RiskEngine({ ...DEFAULT_GLOBAL_RISK });

  const benchBars = barsBySymbol.get(benchmarkSymbol) ?? [];
  let trades = 0;
  let rejects = 0;

  // Index temporel : rejoue tous les symboles bougie par bougie.
  const maxLen = Math.max(...[...barsBySymbol.values()].map((b) => b.length));
  for (let i = 60; i < maxLen; i++) {
    const regime: Regime = detectRegime(benchBars.slice(0, i + 1));
    const benchCloses = benchBars.slice(0, i + 1).map((b) => b.close);

    for (const [symbol, bars] of barsBySymbol) {
      if (i >= bars.length) continue;
      const window = bars.slice(0, i + 1);
      const bar = bars[i];
      const inst = instruments.get(symbol)!;
      const quote = quoteFromBar(bar, inst);
      broker.updateQuote(quote);

      // Sorties d'abord (stop/take-profit) — jamais bloquées.
      const exit = broker.checkExit(quote);
      if (exit) {
        router.submit(exit, quote);
        trades += 1;
        continue;
      }

      const signal = evaluate({
        symbol,
        assetClass: "equity",
        tf: "15m",
        bars: window,
        quote,
        benchmarkCloses: benchCloses,
        regime,
        maxSpreadBps: DEFAULT_GLOBAL_RISK.maxSpreadBps,
      });

      const snapshot = broker.snapshot();
      const hasPosition = snapshot.positions.some((p) => p.symbol === symbol);
      if (hasPosition || signal.side !== "long" || signal.score < SCORE_ENTRY) continue;

      const closes = window.map((b) => b.close);
      const highs = window.map((b) => b.high);
      const lows = window.map((b) => b.low);
      const atrSeries = atr(highs, lows, closes, 14);
      const lastAtr = atrSeries[atrSeries.length - 1];

      const decision = risk.evaluateEntry({
        instrument: inst,
        quote,
        atr: lastAtr,
        side: "buy",
        portfolio: snapshot,
        fxToBase: broker.fxToBase,
      });
      if (!decision.approved) {
        rejects += 1;
        continue;
      }
      router.submit(risk.buildOrder(`bt-${symbol}-${bar.openTime}`, symbol, "buy", decision), quote);
      trades += 1;
    }
  }

  const final = broker.snapshot();
  return {
    finalEquity: final.equity,
    returnPct: Math.round(((final.equity - 100_000) / 100_000) * 10_000) / 100,
    trades,
    rejects,
  };
}

/* ─── CLI ────────────────────────────────────────────────────────────────── */

function main(): void {
  const path = process.argv[2];
  const barsBySymbol = new Map<string, Bar[]>();

  if (path && existsSync(path)) {
    for (const bar of loadBars(path)) {
      const list = barsBySymbol.get(bar.symbol) ?? [];
      list.push(bar);
      barsBySymbol.set(bar.symbol, list);
    }
    console.log(`Backtest sur ${path} — ${barsBySymbol.size} symboles`);
  } else {
    console.log("Aucun fichier de bougies fourni — échantillon SYNTHÉTIQUE (démo du pipeline).");
    barsBySymbol.set("SPY", syntheticBars("SPY", 500, 500, 42));
    barsBySymbol.set("AAPL", syntheticBars("AAPL", 500, 200, 7));
    barsBySymbol.set("MSFT", syntheticBars("MSFT", 500, 400, 99));
  }

  const result = runBacktest(barsBySymbol, "SPY");

  console.log("\n════════ RÉSULTAT BACKTEST ════════");
  console.log(`Equity finale : ${result.finalEquity.toFixed(2)} ${BASE}`);
  console.log(`Rendement     : ${result.returnPct}%`);
  console.log(`Ordres        : ${result.trades} (rejets risque : ${result.rejects})`);
  console.log(
    "\n⚠ BIAIS DU SURVIVANT : cet univers est l'univers ACTUEL — les titres" +
      "\n  disparus/exclus depuis n'y figurent plus. Performance surestimée par" +
      "\n  construction. Coûts et slippage simulés, exécution idéalisée."
  );
}

// Exécution directe uniquement (pas à l'import par les tests).
if (process.argv[1]?.endsWith("backtest.ts")) main();
