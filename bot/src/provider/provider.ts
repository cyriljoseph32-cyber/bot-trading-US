/* ─── Interface fournisseur de données de marché ───────────────────────────
 *
 * Abstraction pour pouvoir remplacer Twelve Data par IBKR ou un flux courtier
 * sans toucher au reste du bot. Un fournisseur pousse des cotations normalisées
 * (Quote) et sert l'historique de bougies pour amorcer les indicateurs.
 */

import type { Bar, Instrument, Quote, Timeframe } from "../types";
import type { SymbolStats } from "../universe";

export type FeedStatus =
  | "unconfigured" // pas de clé API : mode dégradé
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

export interface ProviderEvents {
  onQuote: (quote: Quote) => void;
  onStatus: (status: FeedStatus, detail?: string) => void;
}

export interface MarketDataProvider {
  readonly name: string;
  /** Démarre le flux temps réel pour ces instruments. */
  start(instruments: Instrument[], events: ProviderEvents): void;
  stop(): void;
  status(): FeedStatus;
  /** Bougies historiques pour amorcer les indicateurs (REST). */
  fetchHistory(instrument: Instrument, tf: Timeframe, count: number): Promise<Bar[]>;
  /** Stats de liquidité pour la sélection d'univers dynamique (REST, optionnel). */
  fetchStats?(instruments: Instrument[]): Promise<Record<string, SymbolStats>>;
}
