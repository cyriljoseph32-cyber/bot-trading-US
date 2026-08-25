/* ─── Risque PORTEFEUILLE (pur, testable) ──────────────────────────────────
 *
 * Le passage de 1 à 100 actifs déplace le risque : ce n'est plus la taille
 * d'un trade qui menace le compte, c'est la SOMME des trades et leur
 * redondance. Ce module tient l'état global et arbitre chaque nouvelle entrée.
 *
 * Il complète — sans le remplacer — `bot/src/risk/engine.ts`, qui garde le
 * sizing par ATR, le stop obligatoire et les plafonds pays/devise/secteur.
 * L'ordre est toujours : gouverneur portefeuille → moteur de risque → routeur.
 *
 * RÈGLES DURES, non désactivables :
 *   • jamais de renforcement dans le sens d'une position déjà ouverte
 *     (interdiction de moyenner une perte) ;
 *   • la taille ne dépend JAMAIS des pertes passées (pas de martingale) :
 *     le risque par trade est un % fixe de l'equity, point.
 *   • les SORTIES ne passent pas par ici — fermer réduit le risque et n'est
 *     jamais bloqué.
 */

import type { Direction } from "../strategy/spcfx5/params";
import type { SpcCategory } from "../strategy/spcfx5/params";
import type { GroupBet } from "../strategy/spcfx5/types";

export interface SpcPortfolioParams {
  /** Nombre maximum de positions ouvertes simultanément. */
  maxOpenPositions: number;
  /** Nombre maximum de positions ouvertes par catégorie d'actifs. */
  maxPositionsPerCategory: number;
  /** Risque cumulé maximum sur toutes les positions ouvertes (% equity). */
  maxTotalOpenRiskPct: number;
  /** Risque maximum engagé sur la journée, entrées cumulées (% equity). */
  maxDailyRiskPct: number;
  /** Perte quotidienne déclenchant l'arrêt des nouvelles entrées (%). */
  maxDailyLossPct: number;
  /** Perte hebdomadaire déclenchant l'arrêt des nouvelles entrées (%). */
  maxWeeklyLossPct: number;
  /** Nombre maximal de nouvelles entrées par jour. */
  maxNewEntriesPerDay: number;
  /** Nb de pertes consécutives déclenchant le cooldown (0 = désactivé). */
  cooldownAfterLosses: number;
  /** Durée du cooldown, en minutes. */
  cooldownMinutes: number;
  /** Plafond de risque par défaut pour un groupe corrélé (% equity). */
  correlationGroupMaxRiskPct: number;
  /** Plafonds spécifiques par groupe (surcharge le défaut). */
  correlationGroupOverrides: Record<string, number>;
  /**
   * Écart de score au-delà duquel un signal peut forcer un groupe saturé.
   * 0 = exception désactivée.
   */
  correlationOverrideScoreDelta: number;
  /** Multiplicateur de taille appliqué à une entrée acceptée par exception. */
  correlationOverrideSizeMult: number;
}

export const DEFAULT_SPC_PORTFOLIO: SpcPortfolioParams = {
  maxOpenPositions: 8,
  maxPositionsPerCategory: 3,
  maxTotalOpenRiskPct: 3,
  maxDailyRiskPct: 2,
  maxDailyLossPct: 2,
  maxWeeklyLossPct: 5,
  maxNewEntriesPerDay: 5,
  cooldownAfterLosses: 3,
  cooldownMinutes: 240,
  correlationGroupMaxRiskPct: 1,
  correlationGroupOverrides: {},
  correlationOverrideScoreDelta: 10,
  correlationOverrideSizeMult: 0.5,
};

export type SpcPortfolioReject =
  | "cooldown_active"
  | "daily_loss_limit"
  | "weekly_loss_limit"
  | "max_entries_per_day"
  | "max_open_positions"
  | "max_positions_per_category"
  | "total_open_risk"
  | "daily_risk_budget"
  | "correlation_group_cap"
  | "already_open"
  | "averaging_down";

export interface PortfolioDecision {
  allow: boolean;
  rejects: SpcPortfolioReject[];
  /** 1 en temps normal ; < 1 quand l'entrée passe par l'exception corrélation. */
  sizeMultiplier: number;
  detail: string;
}

/** Une entrée candidate, telle que le classement la propose. */
export interface EntryCandidate {
  symbol: string;
  category: SpcCategory;
  direction: Direction;
  /** Risque demandé, en % de l'equity. */
  riskPct: number;
  score: number;
  groups: GroupBet[];
}

/** Une position suivie par le gouverneur (ouverte ou retenue dans ce lot). */
export interface TrackedEntry {
  symbol: string;
  category: SpcCategory;
  direction: Direction;
  riskPct: number;
  score: number;
  groups: GroupBet[];
  openedAt: number;
}

const dayKey = (ts: number): string => new Date(ts).toISOString().slice(0, 10);

/** Clé de semaine ISO approximée : lundi UTC de la semaine du timestamp. */
export function weekKey(ts: number): string {
  const d = new Date(ts);
  const day = d.getUTCDay();
  const shift = day === 0 ? 6 : day - 1; // lundi = début de semaine
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - shift));
  return monday.toISOString().slice(0, 10);
}

export class PortfolioGovernor {
  private open = new Map<string, TrackedEntry>();
  private currentDay: string;
  private currentWeek: string;
  private entriesToday = 0;
  private riskEngagedTodayPct = 0;
  private dayStartEquity: number;
  private weekStartEquity: number;
  private consecutiveLosses = 0;
  private cooldownUntil = 0;

  constructor(
    public params: SpcPortfolioParams,
    equity: number,
    now: number = Date.now()
  ) {
    this.currentDay = dayKey(now);
    this.currentWeek = weekKey(now);
    this.dayStartEquity = equity;
    this.weekStartEquity = equity;
  }

  /** À appeler régulièrement : bascule des compteurs jour/semaine. */
  rollTime(now: number, equity: number): void {
    const day = dayKey(now);
    if (day !== this.currentDay) {
      this.currentDay = day;
      this.entriesToday = 0;
      this.riskEngagedTodayPct = 0;
      this.dayStartEquity = equity;
    }
    const week = weekKey(now);
    if (week !== this.currentWeek) {
      this.currentWeek = week;
      this.weekStartEquity = equity;
    }
  }

  /** Perte du jour en % (positif = perte). */
  dailyLossPct(equity: number): number {
    if (!(this.dayStartEquity > 0)) return 0;
    return ((this.dayStartEquity - equity) / this.dayStartEquity) * 100;
  }

  /** Perte de la semaine en % (positif = perte). */
  weeklyLossPct(equity: number): number {
    if (!(this.weekStartEquity > 0)) return 0;
    return ((this.weekStartEquity - equity) / this.weekStartEquity) * 100;
  }

  isInCooldown(now: number): boolean {
    return now < this.cooldownUntil;
  }

  cooldownEndsAt(): number {
    return this.cooldownUntil;
  }

  openEntries(): TrackedEntry[] {
    return [...this.open.values()];
  }

  /** Risque ouvert cumulé, en % de l'equity. */
  totalOpenRiskPct(pending: TrackedEntry[] = []): number {
    return [...this.open.values(), ...pending].reduce((s, e) => s + e.riskPct, 0);
  }

  /**
   * Risque déjà engagé sur un groupe corrélé, dans la MÊME direction de pari.
   * Long EURUSD et short USDCHF portent le même pari « USD baisse » : ils
   * s'additionnent ici, c'est tout l'intérêt du signe porté par le groupe.
   */
  groupRiskPct(bet: GroupBet, pending: TrackedEntry[] = []): number {
    return [...this.open.values(), ...pending]
      .filter((e) => e.groups.some((g) => g.group === bet.group && g.direction === bet.direction))
      .reduce((s, e) => s + e.riskPct, 0);
  }

  private groupCap(group: string): number {
    return this.params.correlationGroupOverrides[group] ?? this.params.correlationGroupMaxRiskPct;
  }

  /** Meilleur score déjà retenu sur le même pari de groupe. */
  private bestGroupScore(bet: GroupBet, pending: TrackedEntry[]): number {
    const entries = [...this.open.values(), ...pending].filter((e) =>
      e.groups.some((g) => g.group === bet.group && g.direction === bet.direction)
    );
    return entries.reduce((best, e) => Math.max(best, e.score), 0);
  }

  /**
   * Arbitre une entrée candidate. `pending` contient les entrées déjà retenues
   * dans le même lot de signaux, pas encore exécutées — sans elles, dix
   * signaux simultanés passeraient tous le même plafond.
   */
  evaluate(
    candidate: EntryCandidate,
    equity: number,
    now: number,
    pending: TrackedEntry[] = []
  ): PortfolioDecision {
    const rejects: SpcPortfolioReject[] = [];
    const p = this.params;
    const details: string[] = [];

    // Position déjà ouverte : ni renforcement, ni moyenne à la baisse.
    const existing = this.open.get(candidate.symbol) ?? pending.find((e) => e.symbol === candidate.symbol);
    if (existing) {
      rejects.push(existing.direction === candidate.direction ? "averaging_down" : "already_open");
      details.push(`position déjà ouverte sur ${candidate.symbol} (${existing.direction})`);
      return { allow: false, rejects, sizeMultiplier: 0, detail: details.join(" · ") };
    }

    if (this.isInCooldown(now)) {
      rejects.push("cooldown_active");
      details.push(`cooldown actif jusqu'à ${new Date(this.cooldownUntil).toISOString()}`);
    }

    const dailyLoss = this.dailyLossPct(equity);
    if (dailyLoss >= p.maxDailyLossPct) {
      rejects.push("daily_loss_limit");
      details.push(`perte du jour ${dailyLoss.toFixed(2)}% ≥ ${p.maxDailyLossPct}%`);
    }

    const weeklyLoss = this.weeklyLossPct(equity);
    if (weeklyLoss >= p.maxWeeklyLossPct) {
      rejects.push("weekly_loss_limit");
      details.push(`perte de la semaine ${weeklyLoss.toFixed(2)}% ≥ ${p.maxWeeklyLossPct}%`);
    }

    const entries = this.entriesToday + pending.length;
    if (entries >= p.maxNewEntriesPerDay) {
      rejects.push("max_entries_per_day");
      details.push(`${entries} entrées aujourd'hui ≥ ${p.maxNewEntriesPerDay}`);
    }

    const openCount = this.open.size + pending.length;
    if (openCount >= p.maxOpenPositions) {
      rejects.push("max_open_positions");
      details.push(`${openCount} positions ouvertes ≥ ${p.maxOpenPositions}`);
    }

    const categoryCount = [...this.open.values(), ...pending].filter(
      (e) => e.category === candidate.category
    ).length;
    if (categoryCount >= p.maxPositionsPerCategory) {
      rejects.push("max_positions_per_category");
      details.push(`${categoryCount} positions en ${candidate.category} ≥ ${p.maxPositionsPerCategory}`);
    }

    const totalRisk = this.totalOpenRiskPct(pending);
    if (totalRisk + candidate.riskPct > p.maxTotalOpenRiskPct) {
      rejects.push("total_open_risk");
      details.push(
        `risque ouvert ${(totalRisk + candidate.riskPct).toFixed(2)}% > ${p.maxTotalOpenRiskPct}%`
      );
    }

    const dailyRisk =
      this.riskEngagedTodayPct + pending.reduce((s, e) => s + e.riskPct, 0) + candidate.riskPct;
    if (dailyRisk > p.maxDailyRiskPct) {
      rejects.push("daily_risk_budget");
      details.push(`risque engagé du jour ${dailyRisk.toFixed(2)}% > ${p.maxDailyRiskPct}%`);
    }

    // ── Corrélation : un groupe saturé bloque, sauf exception de score ──
    let sizeMultiplier = 1;
    for (const bet of candidate.groups) {
      const cap = this.groupCap(bet.group);
      const used = this.groupRiskPct(bet, pending);
      if (used + candidate.riskPct <= cap) continue;

      const best = this.bestGroupScore(bet, pending);
      const delta = p.correlationOverrideScoreDelta;
      const canOverride = delta > 0 && candidate.score >= best + delta;
      if (!canOverride) {
        rejects.push("correlation_group_cap");
        details.push(
          `groupe ${bet.group}/${bet.direction} : ${(used + candidate.riskPct).toFixed(2)}% > ${cap}%`
        );
        continue;
      }
      // Exception accordée : on entre, mais avec une taille réduite.
      sizeMultiplier = Math.min(sizeMultiplier, p.correlationOverrideSizeMult);
      details.push(
        `groupe ${bet.group}/${bet.direction} saturé mais score ${candidate.score} ≥ ${best}+${delta} → taille × ${p.correlationOverrideSizeMult}`
      );
    }

    if (rejects.length > 0) {
      return { allow: false, rejects, sizeMultiplier: 0, detail: details.join(" · ") };
    }
    return {
      allow: true,
      rejects: [],
      sizeMultiplier,
      detail: details.length > 0 ? details.join(" · ") : "tous les plafonds portefeuille respectés",
    };
  }

  /** Enregistre une entrée EXÉCUTÉE (après acceptation du moteur de risque). */
  registerEntry(entry: TrackedEntry): void {
    this.open.set(entry.symbol, entry);
    this.entriesToday += 1;
    this.riskEngagedTodayPct += entry.riskPct;
  }

  /**
   * Enregistre une sortie. Une perte incrémente la série ; `cooldownAfterLosses`
   * pertes consécutives déclenchent le cooldown. Un gain remet le compteur à
   * zéro. La taille des trades suivants n'est JAMAIS modifiée par ce compteur.
   */
  registerExit(symbol: string, pnl: number, now: number = Date.now()): void {
    this.open.delete(symbol);
    if (pnl < 0) {
      this.consecutiveLosses += 1;
      if (
        this.params.cooldownAfterLosses > 0 &&
        this.consecutiveLosses >= this.params.cooldownAfterLosses
      ) {
        this.cooldownUntil = now + this.params.cooldownMinutes * 60_000;
        this.consecutiveLosses = 0;
      }
    } else {
      this.consecutiveLosses = 0;
    }
  }

  /** Photo de l'état, pour le dashboard et les tests. */
  snapshot(equity: number, now: number = Date.now()) {
    return {
      day: this.currentDay,
      week: this.currentWeek,
      openPositions: this.open.size,
      entriesToday: this.entriesToday,
      riskEngagedTodayPct: round2(this.riskEngagedTodayPct),
      totalOpenRiskPct: round2(this.totalOpenRiskPct()),
      dailyLossPct: round2(this.dailyLossPct(equity)),
      weeklyLossPct: round2(this.weeklyLossPct(equity)),
      consecutiveLosses: this.consecutiveLosses,
      cooldownActive: this.isInCooldown(now),
      cooldownUntil: this.cooldownUntil > 0 ? new Date(this.cooldownUntil).toISOString() : null,
    };
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;
