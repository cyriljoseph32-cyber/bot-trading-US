import { positionSize } from "./strategy";

/* ─── Moteur de gestion du risque (pur, sans I/O — donc testable) ───────────
 *
 * Rôle : décider, AVANT d'envoyer un ordre au courtier, si une entrée est
 * autorisée et avec quelle taille. C'est la couche qui rend l'argent réel
 * acceptable. Tout est déterministe : aucune lecture réseau ni d'environnement.
 *
 * Principe de sécurité fondamental :
 *   • Les ENTRÉES peuvent être bloquées (kill switch, perte du jour, quotas).
 *   • Les SORTIES ne sont JAMAIS bloquées par le risque — fermer une position
 *     réduit le risque, on doit toujours pouvoir le faire.
 */

export interface RiskParams {
  /** % du capital risqué entre entrée et stop, par trade. */
  riskPct: number;
  /** Halte des nouvelles entrées si la perte du jour atteint ce % de l'equity. */
  maxDailyLossPct: number;
  /** Nombre maximum de positions simultanées. */
  maxOpenPositions: number;
  /** Nombre maximum d'entrées par jour (anti-sur-trading). */
  maxTradesPerDay: number;
  /** Taille maximale d'une seule position, en % de l'equity (anti-concentration). */
  maxPositionPct: number;
  /** Exposition brute maximale (somme des positions) en % de l'equity (anti-corrélation). */
  maxGrossExposurePct: number;
  /** Arrêt d'urgence global : aucune nouvelle entrée. */
  killSwitch: boolean;
}

/** Valeurs par défaut prudentes (modifiables via variables d'environnement). */
export const DEFAULT_RISK: RiskParams = {
  riskPct: 1,
  maxDailyLossPct: 3,
  maxOpenPositions: 5,
  maxTradesPerDay: 3,
  maxPositionPct: 20,
  maxGrossExposurePct: 70,
  killSwitch: false,
};

export interface RiskState {
  /** Valeur actuelle du compte. */
  equity: number;
  /** Equity à la clôture précédente (Alpaca `last_equity`) — base du P&L du jour. */
  lastEquity: number;
  /** Positions actuellement ouvertes. */
  openPositions: number;
  /** Entrées déjà passées aujourd'hui. */
  tradesToday: number;
  /** Valeur de marché totale des positions ouvertes (exposition brute). Défaut 0. */
  investedValue?: number;
}

export interface EntryIntent {
  symbol: string;
  entry: number;
  stop: number;
}

export type RejectReason =
  | "kill_switch"
  | "perte_quotidienne"
  | "max_positions"
  | "max_trades"
  | "stop_invalide"
  | "exposition_max"
  | "capital_insuffisant";

export interface RiskDecision {
  approved: boolean;
  qty: number;
  reason?: RejectReason;
  detail?: string;
}

/** Perte du jour en % (positif = perte, négatif = gain). */
export function dailyLossPct(state: RiskState): number {
  if (!(state.lastEquity > 0)) return 0;
  return ((state.lastEquity - state.equity) / state.lastEquity) * 100;
}

/** Les nouvelles entrées sont-elles bloquées au niveau du portefeuille ? */
export function entriesHalted(
  params: RiskParams,
  state: RiskState
): { halted: boolean; reason?: RejectReason; detail?: string } {
  if (params.killSwitch) {
    return { halted: true, reason: "kill_switch", detail: "Arrêt d'urgence actif (KILL_SWITCH)" };
  }
  const loss = dailyLossPct(state);
  if (loss >= params.maxDailyLossPct) {
    return {
      halted: true,
      reason: "perte_quotidienne",
      detail: `Perte du jour ${loss.toFixed(2)} % ≥ limite ${params.maxDailyLossPct} %`,
    };
  }
  return { halted: false };
}

/**
 * Évalue une intention d'entrée et renvoie la quantité autorisée (ou un rejet).
 * Ne modifie aucun état : l'appelant doit incrémenter openPositions / tradesToday
 * après une approbation s'il enchaîne plusieurs entrées dans la même passe.
 */
export function evaluateEntry(
  intent: EntryIntent,
  params: RiskParams,
  state: RiskState
): RiskDecision {
  const halt = entriesHalted(params, state);
  if (halt.halted) return { approved: false, qty: 0, reason: halt.reason, detail: halt.detail };

  if (state.openPositions >= params.maxOpenPositions) {
    return {
      approved: false, qty: 0, reason: "max_positions",
      detail: `${state.openPositions}/${params.maxOpenPositions} positions déjà ouvertes`,
    };
  }
  if (state.tradesToday >= params.maxTradesPerDay) {
    return {
      approved: false, qty: 0, reason: "max_trades",
      detail: `${state.tradesToday}/${params.maxTradesPerDay} entrées déjà passées aujourd'hui`,
    };
  }

  const riskPerShare = intent.entry - intent.stop;
  if (!(riskPerShare > 0)) {
    return { approved: false, qty: 0, reason: "stop_invalide", detail: "Stop ≥ entrée" };
  }

  // Taille par le risque, puis plafonnée par la concentration max.
  let qty = positionSize(state.equity, params.riskPct, intent.entry, intent.stop);
  const maxByConcentration = Math.floor(
    (state.equity * params.maxPositionPct) / 100 / intent.entry
  );
  if (maxByConcentration < qty) qty = maxByConcentration;

  // Plafond d'exposition brute du portefeuille (anti-corrélation) — fix #5.
  // Ne rejette pour "exposition_max" QUE si c'est l'exposition brute qui fait
  // tomber la taille sous 1 (sinon on laisse "capital_insuffisant" gérer).
  const invested = state.investedValue ?? 0;
  const roomGross = (state.equity * params.maxGrossExposurePct) / 100 - invested;
  const maxByGross = Math.max(0, Math.floor(roomGross / intent.entry));
  if (maxByGross < qty) {
    qty = maxByGross;
    if (qty < 1) {
      return {
        approved: false, qty: 0, reason: "exposition_max",
        detail: `Exposition brute max ${params.maxGrossExposurePct} % atteinte (investi ${invested.toFixed(0)}/${state.equity.toFixed(0)})`,
      };
    }
  }

  if (qty < 1) {
    return {
      approved: false, qty: 0, reason: "capital_insuffisant",
      detail: `Capital insuffisant pour 1 action (risque ${params.riskPct} %, plafond ${params.maxPositionPct} %)`,
    };
  }
  return { approved: true, qty };
}
