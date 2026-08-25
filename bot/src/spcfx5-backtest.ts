/* ─── Backtest SPC FX5 — MÊME moteur que le temps réel ─────────────────────
 *
 * Rejoue des bougies H1 (JSONL persisté par le bot, ou échantillon synthétique
 * déterministe) à travers SpcEngine — c'est-à-dire exactement le code de
 * production : mêmes filtres, même scoring, même classement, mêmes plafonds
 * portefeuille, même PaperBroker (frais, slippage, conversion FX).
 *
 * ⚠ LIMITES, à garder en tête avant d'interpréter le moindre chiffre :
 *   • le chemin intra-bougie est reconstitué de façon CONSERVATRICE (stop
 *     avant take-profit si les deux sont dans la bougie), mais reste une
 *     approximation — les vrais ticks manquent ;
 *   • le spread est ESTIMÉ à partir des coûts configurés, pas observé ;
 *   • BIAIS DU SURVIVANT : la watchlist actuelle ne contient pas les actifs
 *     retirés de la cote ou devenus illiquides ;
 *   • l'échantillon synthétique ne prouve RIEN sur la rentabilité : il ne
 *     sert qu'à vérifier que la chaîne complète tourne.
 * Un backtest est un test de cohérence, pas une promesse de performance.
 *
 * Usage : npm run bot:spcfx5-backtest [-- chemin/vers/bars.jsonl]
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./log";
import { MemoryStore } from "./store";
import { PaperBroker } from "./exec/paper";
import { OrderRouter } from "./exec/router";
import { RiskEngine, DEFAULT_GLOBAL_RISK } from "./risk/engine";
import { PortfolioGovernor, DEFAULT_SPC_PORTFOLIO } from "./risk/portfolio";
import { SpcEngine } from "./strategy/spcfx5/engine";
import { DEFAULT_SPC_PARAMS, mergeParams } from "./strategy/spcfx5/params";
import {
  loadSpcConfig,
  selectSpcUniverse,
  correlationOverrides,
  costBpsOf,
} from "./strategy/spcfx5/universe";
import type { SpcUniverseEntry } from "./strategy/spcfx5/types";
import type { Bar } from "./types";

const START_CAPITAL = 100_000;

/**
 * Bougies H1 synthétiques : marche aléatoire avec régimes de tendance
 * alternés, graine fixe — reproductible sans dépendance ni réseau.
 */
export function syntheticH1Bars(
  symbol: string,
  count: number,
  startPrice: number,
  seed: number
): Bar[] {
  let s = seed;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const bars: Bar[] = [];
  let price = startPrice;
  // 5 janvier 2026, 00:00 UTC — aligné sur l'heure.
  const t0 = Date.UTC(2026, 0, 5, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    // Régimes de 120 bougies : hausse, baisse, range.
    const phase = Math.floor(i / 120) % 3;
    const drift = phase === 0 ? 0.0004 : phase === 1 ? -0.0004 : 0;
    const shock = (rand() - 0.5) * 0.006;
    const open = price;
    price = Math.max(0.0001, price * (1 + drift + shock));
    bars.push({
      symbol,
      tf: "1h",
      openTime: t0 + i * 3_600_000,
      open,
      high: Math.max(open, price) * (1 + rand() * 0.0015),
      low: Math.min(open, price) * (1 - rand() * 0.0015),
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
    .filter((b) => b.tf === "1h")
    .sort((a, b) => a.openTime - b.openTime);
}

function main(): void {
  const configPath =
    process.env.SPC_CONFIG ?? join(import.meta.dirname, "..", "config", "spcfx5.json");
  const config = loadSpcConfig(configPath);
  const params = mergeParams(DEFAULT_SPC_PARAMS, config.params ?? {});
  // Le filtre de session est désactivé en backtest : les données synthétiques
  // n'ont pas de calendrier de séance réaliste.
  params.session = { ...params.session, enabled: false };

  const { selected } = selectSpcUniverse(config, Number(process.env.SPC_MAX_SYMBOLS ?? 100));

  const path = process.argv[2];
  let barsBySymbol = new Map<string, Bar[]>();
  let universe: SpcUniverseEntry[];

  if (path && existsSync(path)) {
    const all = loadBars(path);
    for (const bar of all) {
      const list = barsBySymbol.get(bar.symbol) ?? [];
      list.push(bar);
      barsBySymbol.set(bar.symbol, list);
    }
    universe = selected.filter((e) => barsBySymbol.has(e.instrument.symbol));
    logger.info(
      "backtest",
      `${all.length} bougies H1 chargées depuis ${path} — ${universe.length} actifs couverts`
    );
    if (universe.length === 0) {
      logger.error("backtest", "aucun symbole du fichier ne figure dans la watchlist SPC FX5");
      return;
    }
  } else {
    // Échantillon : les 6 premiers actifs actifs de la watchlist.
    universe = selected.slice(0, 6);
    barsBySymbol = new Map(
      universe.map((entry, index) => [
        entry.instrument.symbol,
        syntheticH1Bars(entry.instrument.symbol, 900, 100 + index * 25, 12345 + index * 7),
      ])
    );
    logger.warn(
      "backtest",
      "aucun fichier fourni — échantillon SYNTHÉTIQUE : vérifie la chaîne, ne mesure aucune performance"
    );
  }

  /* ─── Composants : exactement ceux du temps réel ───────────────────── */
  const store = new MemoryStore();
  const broker = new PaperBroker(START_CAPITAL, "USD");
  broker.registerInstruments(universe.map((u) => u.instrument));
  for (const entry of universe) broker.updateFxRate(entry.instrument.currency, 1);
  const router = new OrderRouter(broker, false, null);
  const risk = new RiskEngine({ ...DEFAULT_GLOBAL_RISK });
  const governor = new PortfolioGovernor(
    {
      ...DEFAULT_SPC_PORTFOLIO,
      ...(config.portfolio ?? {}),
      correlationGroupOverrides: correlationOverrides(config),
    },
    START_CAPITAL,
    [...barsBySymbol.values()][0]?.[0]?.openTime ?? Date.now()
  );
  const engine = new SpcEngine({
    config,
    universe,
    params,
    broker,
    router,
    risk,
    governor,
    store,
    news: null,
  });

  /* ─── Rejeu chronologique, heure par heure ─────────────────────────── */
  const timeline = [...new Set([...barsBySymbol.values()].flat().map((b) => b.openTime))].sort(
    (a, b) => a - b
  );
  const byKey = new Map<string, Bar>();
  for (const [symbol, bars] of barsBySymbol) {
    for (const bar of bars) byKey.set(`${symbol}|${bar.openTime}`, bar);
  }

  let cycles = 0;
  for (const openTime of timeline) {
    for (const entry of universe) {
      const bar = byKey.get(`${entry.instrument.symbol}|${openTime}`);
      if (!bar) continue;
      engine.ingestBar(entry, bar, costBpsOf(entry.asset, config) ?? params.cost.defaultCostBps);
    }
    engine.runCycle(openTime + 3_600_000);
    cycles += 1;
  }

  /* ─── Résultats ────────────────────────────────────────────────────── */
  const snapshot = broker.snapshot();
  const filled = store.orders.filter((o) => o.status === "filled");
  const signals = store.records.filter((r) => r.kind === "spcfx5-signals");
  const eligible = signals.filter((r) => (r.record as { eligible?: boolean }).eligible === true);

  console.log("\n─── SPC FX5 — résultat du backtest ───");
  console.log(`Actifs            : ${universe.length}`);
  console.log(`Cycles H1         : ${cycles}`);
  console.log(`Évaluations       : ${signals.length}`);
  console.log(`Setups éligibles  : ${eligible.length}`);
  console.log(`Ordres exécutés   : ${filled.length}`);
  console.log(`Capital initial   : ${START_CAPITAL.toFixed(2)} USD`);
  console.log(`Equity finale     : ${snapshot.equity.toFixed(2)} USD`);
  console.log(`P&L réalisé       : ${snapshot.realizedPnl.toFixed(2)} USD`);
  console.log(`P&L latent        : ${snapshot.unrealizedPnl.toFixed(2)} USD`);
  console.log(`Positions ouvertes: ${snapshot.positions.length}`);

  // Histogramme des rejets : dit immédiatement quel filtre étrangle le flux
  // de signaux — indispensable pour régler les seuils sans tâtonner.
  const histogram = new Map<string, number>();
  for (const { record } of signals) {
    for (const code of (record as { rejects: string[] }).rejects) {
      histogram.set(code, (histogram.get(code) ?? 0) + 1);
    }
  }
  const top = [...histogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (top.length > 0) {
    console.log("\nPrincipaux motifs de rejet :");
    for (const [code, count] of top) {
      console.log(`  ${code.padEnd(26)} ${count} (${((count / signals.length) * 100).toFixed(1)} %)`);
    }
  }
  console.log("\n⚠ Résultat indicatif : coûts et chemin intra-bougie approximés,");
  console.log("  biais du survivant, échantillon limité. Aucune promesse de performance,");
  console.log("  et ceci n'est pas un conseil en investissement.\n");
}

// Exécution directe uniquement (pas à l'import par les tests).
if (process.argv[1]?.endsWith("spcfx5-backtest.ts")) main();
