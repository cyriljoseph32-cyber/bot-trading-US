/* ─── Gestion d'une position ouverte : break-even et trailing (pur) ────────
 *
 * Calcule le nouveau stop d'une position en fonction du chemin parcouru,
 * exprimé en R (multiples du risque initial). Deux étapes cumulables :
 *   • break-even : à +1R (configurable), le stop remonte au prix d'entrée ;
 *   • trailing   : au-delà de +1R ou +1,5R, le stop suit à N×ATR du prix.
 *
 * La fonction ne décide RIEN d'irréversible : elle renvoie un stop proposé,
 * que `PaperBroker.updateStop` n'appliquera que s'il resserre le risque.
 */

import type { StopParams } from "./params";

export interface ManageInput {
  direction: "long" | "short";
  entryPrice: number;
  /** Stop courant de la position. */
  currentStop: number;
  /** Risque initial par unité (|entrée − stop initial|). */
  initialRisk: number;
  /** Dernier prix connu. */
  price: number;
  /** ATR courant (devise de cotation). */
  atr: number | null;
  params: StopParams;
}

export interface ManageResult {
  /** Nouveau stop proposé, ou null si rien à changer. */
  newStop: number | null;
  /** Progression actuelle, en multiples de R. */
  rMultiple: number;
  reason: string;
}

export function manageStop(input: ManageInput): ManageResult {
  const { direction, entryPrice, currentStop, initialRisk, price, atr, params } = input;
  if (!(initialRisk > 0) || !(price > 0)) {
    return { newStop: null, rMultiple: 0, reason: "risque initial invalide" };
  }

  const progress = direction === "long" ? price - entryPrice : entryPrice - price;
  const rMultiple = progress / initialRisk;

  let candidate: number | null = null;
  let reason = `+${rMultiple.toFixed(2)}R — aucun ajustement`;

  // 1) Break-even.
  if (params.breakEvenAtR !== null && rMultiple >= params.breakEvenAtR) {
    candidate = entryPrice;
    reason = `+${rMultiple.toFixed(2)}R ≥ ${params.breakEvenAtR}R → stop au point mort`;
  }

  // 2) Trailing : ne s'applique qu'au-delà du seuil, et seulement s'il est
  //    PLUS proche du prix que le break-even (le stop ne recule jamais).
  if (params.trailAfterR !== null && rMultiple >= params.trailAfterR && atr !== null && atr > 0) {
    const trail =
      direction === "long"
        ? price - atr * params.trailAtrMult
        : price + atr * params.trailAtrMult;
    if (candidate === null || (direction === "long" ? trail > candidate : trail < candidate)) {
      candidate = trail;
      reason = `+${rMultiple.toFixed(2)}R ≥ ${params.trailAfterR}R → trailing à ${params.trailAtrMult}×ATR`;
    }
  }

  if (candidate === null) return { newStop: null, rMultiple, reason };

  // Le stop ne doit jamais s'éloigner du prix ni le dépasser.
  const tightensRisk = direction === "long" ? candidate > currentStop : candidate < currentStop;
  const staysBehindPrice = direction === "long" ? candidate < price : candidate > price;
  if (!tightensRisk || !staysBehindPrice) {
    return { newStop: null, rMultiple, reason: `${reason} (déjà appliqué)` };
  }

  return { newStop: candidate, rMultiple, reason };
}
