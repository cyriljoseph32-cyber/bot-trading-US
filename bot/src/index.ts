/* ─── Point d'entrée du bot global (mode paper par défaut) ─────────────────
 *
 * Câblage : env → univers → provider (Twelve Data) → agrégation de bougies →
 * pipeline de stratégie → moteur de risque → routeur d'ordres (paper) →
 * serveur dashboard/API.
 *
 * Sans TWELVEDATA_API_KEY : démarre en mode dégradé (dashboard + API up,
 * flux "unconfigured") — utile pour valider l'installation.
 */

import { join } from "node:path";
import { loadEnv } from "./env";
import { logger } from "./log";
import { loadUniverseConfig, selectUniverse, capToWsLimit, type SymbolStats } from "./universe";
import { TwelveDataProvider } from "./provider/twelvedata";
import type { FeedStatus } from "./provider/provider";
import { BarAggregator } from "./bars";
import { JsonlStore } from "./store";
import { evaluate, detectRegime, type Regime } from "./strategy/pipeline";
import { RiskEngine, DEFAULT_GLOBAL_RISK } from "./risk/engine";
import { PaperBroker } from "./exec/paper";
import { OrderRouter } from "./exec/router";
import { startServer } from "./server";
import { atr } from "../../src/trading/indicators";
import type { Instrument, Quote, ScoredSignal } from "./types";

const SCORE_ENTRY = 70;
const SIGNAL_TF = "15m" as const;

async function main(): Promise<void> {
  const env = loadEnv();
  logger.info("boot", `démarrage — LIVE_TRADING=${env.liveTrading} (paper par défaut)`);

  // ── Univers ──────────────────────────────────────────────────────────
  const config = loadUniverseConfig(join(import.meta.dirname, "..", "config", "universe.json"));
  const provider = new TwelveDataProvider(env.twelveDataApiKey, env.tdRestRpm);

  let stats: Record<string, SymbolStats> = {};
  const preliminary = selectUniverse(config);
  if (env.universeDynamic && env.twelveDataApiKey) {
    logger.info("universe", "rafraîchissement dynamique des stats de liquidité…");
    stats = await provider.fetchStats(preliminary.filter((i) => i.assetClass === "equity"));
  }
  const benchmark: Instrument = { ...config.benchmark, assetClass: "equity" };
  const universe = capToWsLimit(selectUniverse(config, stats), benchmark, env.tdWsSymbolLimit);
  const bySymbol = new Map(universe.map((i) => [i.symbol, i]));
  logger.info(
    "universe",
    `${universe.length} instruments suivis (limite WS ${env.tdWsSymbolLimit}) : ` +
      universe.map((i) => i.symbol).join(", ")
  );

  // ── Composants ───────────────────────────────────────────────────────
  const store = new JsonlStore(env.dataDir);
  const broker = new PaperBroker(env.paperCapital, env.baseCurrency);
  broker.registerInstruments(universe);
  const router = new OrderRouter(broker, env.liveTrading, null); // aucun adaptateur réel fourni
  const risk = new RiskEngine({ ...DEFAULT_GLOBAL_RISK, killSwitch: env.killSwitch });

  const latestSignals = new Map<string, ScoredSignal>();
  const latestQuotes = new Map<string, Quote>();
  let feedDetail = "";
  let regime: Regime = "neutral";

  // ── Conversion FX : les paires du flux alimentent les taux du broker ──
  function updateFxRates(quote: Quote): void {
    if (quote.assetClass !== "fx") return;
    const [from, to] = quote.symbol.split("/");
    if (!from || !to || !(quote.last > 0)) return;
    if (to === env.baseCurrency) broker.updateFxRate(from, quote.last);
    else if (from === env.baseCurrency) broker.updateFxRate(to, 1 / quote.last);
  }

  // ── Agrégation → signaux → (éventuellement) ordre papier ─────────────
  const aggregator = new BarAggregator(({ bar }) => {
    store.saveBar(bar);
    if (bar.symbol === benchmark.symbol && bar.tf === SIGNAL_TF) {
      regime = detectRegime(aggregator.getBars(benchmark.symbol, SIGNAL_TF));
    }
    if (bar.tf !== SIGNAL_TF) return;

    const inst = bySymbol.get(bar.symbol);
    if (!inst) return;
    const quote = latestQuotes.get(bar.symbol) ?? null;
    const signal = evaluate({
      symbol: bar.symbol,
      assetClass: inst.assetClass,
      tf: SIGNAL_TF,
      bars: aggregator.getBars(bar.symbol, SIGNAL_TF),
      quote,
      benchmarkCloses: aggregator.getBars(benchmark.symbol, SIGNAL_TF).map((b) => b.close),
      regime,
      maxSpreadBps: risk.params.maxSpreadBps,
    });
    latestSignals.set(bar.symbol, signal);
    store.saveSignal(signal);

    // Entrée papier : signal long fort, pas de position, risque approuvé.
    if (!quote || signal.side !== "long" || signal.score < SCORE_ENTRY) return;
    const snapshot = broker.snapshot();
    if (snapshot.positions.some((p) => p.symbol === bar.symbol)) return;

    const bars = aggregator.getBars(bar.symbol, SIGNAL_TF);
    const atrSeries = atr(
      bars.map((b) => b.high),
      bars.map((b) => b.low),
      bars.map((b) => b.close),
      14
    );
    const decision = risk.evaluateEntry({
      instrument: inst,
      quote,
      atr: atrSeries[atrSeries.length - 1],
      side: "buy",
      portfolio: snapshot,
      fxToBase: broker.fxToBase,
    });
    if (!decision.approved) {
      logger.info("risk", `${bar.symbol} entrée refusée : ${decision.rejects.join(", ")}`);
      return;
    }
    const order = risk.buildOrder(`live-${bar.symbol}-${bar.openTime}`, bar.symbol, "buy", decision);
    const result = router.submit(order, quote);
    store.saveOrder(result);
    if (result.status === "rejected") risk.recordFailure();
    else risk.recordSuccess();
  });

  // ── Flux temps réel ──────────────────────────────────────────────────
  provider.start(universe, {
    onQuote: (quote) => {
      latestQuotes.set(quote.symbol, quote);
      updateFxRates(quote);
      broker.updateQuote(quote);
      aggregator.onQuote(quote);
      // Sorties (stop/TP) vérifiées sur CHAQUE tick — jamais bloquées.
      const exit = broker.checkExit(quote);
      if (exit) store.saveOrder(router.submit(exit, quote));
    },
    onStatus: (_status: FeedStatus, detail?: string) => {
      feedDetail = detail ?? "";
    },
  });

  // ── Amorçage de l'historique (REST, limité par le token bucket) ──────
  if (env.twelveDataApiKey) {
    void (async () => {
      for (const inst of universe) {
        try {
          aggregator.seed(await provider.fetchHistory(inst, SIGNAL_TF, 200));
          logger.info("seed", `historique ${SIGNAL_TF} chargé pour ${inst.symbol}`);
        } catch (e) {
          logger.warn("seed", `historique indisponible pour ${inst.symbol}: ${String(e)}`);
        }
      }
      regime = detectRegime(aggregator.getBars(benchmark.symbol, SIGNAL_TF));
      logger.info("seed", `amorçage terminé — régime : ${regime}`);
    })();
  }

  // ── Tâches périodiques ───────────────────────────────────────────────
  setInterval(() => {
    aggregator.flushExpired(Date.now(), (s) => bySymbol.get(s)?.assetClass ?? "equity");
  }, 10_000);

  let lastDay = new Date().getUTCDate();
  setInterval(() => {
    const day = new Date().getUTCDate();
    if (day !== lastDay) {
      lastDay = day;
      broker.rollDay();
      logger.info("pnl", "nouveau jour UTC — base du P&L quotidien réinitialisée");
    }
  }, 30_000);

  // ── Dashboard/API ────────────────────────────────────────────────────
  startServer(
    {
      feedStatus: () => provider.status(),
      feedDetail: () => feedDetail,
      universe: () => universe,
      signals: () => [...latestSignals.values()],
      portfolio: () => broker.snapshot(),
      risk,
      quotesAgeMs: () => {
        const now = Date.now();
        const out: Record<string, number> = {};
        for (const [symbol, q] of latestQuotes) out[symbol] = now - q.ts;
        return out;
      },
      startedAt: Date.now(),
    },
    env.port,
    process.env.BOT_BIND ?? "127.0.0.1"
  );

  logger.info("boot", "bot prêt — mode ANALYSE + PAPER (aucun ordre réel possible sans adaptateur)");
}

main().catch((e) => {
  console.error("Échec du démarrage :", e);
  process.exit(1);
});
