/* ─── Routeur d'ordres — garde-fou du trading réel ─────────────────────────
 *
 * RÈGLE ABSOLUE : un ordre ne part vers un courtier RÉEL que si
 *   1. LIVE_TRADING === "true" (variable d'environnement explicite), ET
 *   2. un adaptateur réel a été explicitement fourni au routeur.
 * Aucun adaptateur réel n'existe dans ce dépôt : par construction, tout
 * finit en paper trading. Ce choix est volontaire — brancher un courtier
 * réel doit être un acte délibéré (implémenter BrokerAdapter, le passer ici,
 * ET activer LIVE_TRADING).
 */

import type { OrderRequest, OrderResult, Quote } from "../types";
import type { BrokerAdapter } from "./broker";
import { logger } from "../log";

export class OrderRouter {
  constructor(
    private readonly paper: BrokerAdapter,
    private readonly liveTradingFlag: boolean,
    private readonly liveAdapter: BrokerAdapter | null = null
  ) {
    if (liveTradingFlag && !liveAdapter) {
      logger.warn(
        "router",
        "LIVE_TRADING=true mais aucun adaptateur réel fourni — tout reste en paper"
      );
    }
    if (liveAdapter && liveAdapter.isLive && !liveTradingFlag) {
      logger.warn("router", "adaptateur réel fourni mais LIVE_TRADING absent — ignoré");
    }
  }

  /** true seulement si les DEUX conditions du réel sont réunies. */
  isLive(): boolean {
    return this.liveTradingFlag && this.liveAdapter !== null && this.liveAdapter.isLive;
  }

  target(): BrokerAdapter {
    return this.isLive() ? (this.liveAdapter as BrokerAdapter) : this.paper;
  }

  submit(order: OrderRequest, quote: Quote): OrderResult {
    const broker = this.target();
    const result = broker.submit(order, quote);
    logger.info(
      "exec",
      `[${broker.name}] ${order.side} ${order.qty} ${order.symbol} → ${result.status}` +
        (result.fillPrice ? ` @ ${result.fillPrice}` : "") +
        (result.reason ? ` (${result.reason})` : "")
    );
    return result;
  }
}
