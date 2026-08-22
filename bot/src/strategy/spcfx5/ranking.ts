/* ─── Classement et sélection des signaux (pur) ────────────────────────────
 *
 * Tous les signaux ne se valent pas. À chaque clôture H1, on trie les setups
 * éligibles du meilleur au moins bon, puis on descend la liste en soumettant
 * chacun au gouverneur de portefeuille. Les meilleurs scores passent en
 * premier ; les suivants ne passent que si le budget de risque et les
 * plafonds de corrélation le permettent encore.
 */

import type { PortfolioDecision, PortfolioGovernor, TrackedEntry } from "../../risk/portfolio";
import { groupBets } from "./universe";
import type { Direction } from "./params";
import type { SpcAsset, SpcSignal } from "./types";

export interface RankedSignal {
  signal: SpcSignal;
  asset: SpcAsset;
  /** Rang dans le classement (1 = meilleur score). */
  rank: number;
  decision: PortfolioDecision;
  selected: boolean;
  /** Risque effectif après application du multiplicateur de taille. */
  riskPct: number;
}

export interface RankingInput {
  /** Signaux évalués (éligibles ou non — les non éligibles sont écartés ici). */
  signals: Array<{ signal: SpcSignal; asset: SpcAsset }>;
  governor: PortfolioGovernor;
  equity: number;
  now: number;
  /** Risque nominal par trade, en % de l'equity. */
  riskPctPerTrade: number;
}

/**
 * Trie et sélectionne. Ne modifie PAS l'état du gouverneur : les entrées
 * retenues sont accumulées dans une liste `pending` transmise aux arbitrages
 * suivants, de sorte que dix signaux simultanés ne franchissent pas dix fois
 * le même plafond. Le runner enregistre l'entrée pour de bon (registerEntry)
 * seulement une fois l'ordre accepté par le moteur de risque et le courtier.
 */
export function rankAndSelect(input: RankingInput): RankedSignal[] {
  const eligible = input.signals.filter(
    (s) => s.signal.eligible && (s.signal.side === "long" || s.signal.side === "short")
  );

  // Tri principal : score décroissant. Départage : RR net, puis symbole
  // (déterminisme — un backtest doit être reproductible).
  const sorted = [...eligible].sort((a, b) => {
    if (b.signal.score !== a.signal.score) return b.signal.score - a.signal.score;
    const rr = (b.signal.rrNet ?? 0) - (a.signal.rrNet ?? 0);
    if (rr !== 0) return rr;
    return a.signal.std.localeCompare(b.signal.std);
  });

  const pending: TrackedEntry[] = [];
  const out: RankedSignal[] = [];

  sorted.forEach(({ signal, asset }, index) => {
    const direction = signal.side as Direction;
    const bets = groupBets(asset, direction);
    const decision = input.governor.evaluate(
      {
        symbol: signal.symbol,
        category: signal.category,
        direction,
        riskPct: input.riskPctPerTrade,
        score: signal.score,
        groups: bets,
      },
      input.equity,
      input.now,
      pending
    );

    const riskPct = decision.allow ? input.riskPctPerTrade * decision.sizeMultiplier : 0;
    if (decision.allow) {
      pending.push({
        symbol: signal.symbol,
        category: signal.category,
        direction,
        riskPct,
        score: signal.score,
        groups: bets,
        openedAt: input.now,
      });
    }

    out.push({
      signal,
      asset,
      rank: index + 1,
      decision,
      selected: decision.allow,
      riskPct: Math.round(riskPct * 1e4) / 1e4,
    });
  });

  return out;
}
