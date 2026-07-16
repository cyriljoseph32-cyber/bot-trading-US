/* ─── Interface d'adaptateur courtier ──────────────────────────────────────
 *
 * Le PaperBroker implémente cette interface ; un adaptateur RÉEL (IBKR,
 * Alpaca…) devra l'implémenter aussi. AUCUN adaptateur réel n'est fourni
 * dans ce dépôt : voir exec/router.ts pour la garde LIVE_TRADING.
 */

import type { OrderRequest, OrderResult, PortfolioSnapshot, Quote } from "../types";

export interface BrokerAdapter {
  readonly name: string;
  readonly isLive: boolean;
  submit(order: OrderRequest, quote: Quote): OrderResult;
  snapshot(): PortfolioSnapshot;
}
