/* ─── Client Alpaca (courtier US, API REST) ────────────────────────────────
 *
 * Variables d'environnement :
 *   ALPACA_KEY_ID / ALPACA_SECRET_KEY : clés API Alpaca
 *   ALPACA_LIVE="true"                : compte RÉEL (sinon paper trading,
 *                                       argent fictif — le défaut, volontairement)
 */

export function alpacaConfigured(): boolean {
  return Boolean(process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY);
}

export function isLive(): boolean {
  return process.env.ALPACA_LIVE === "true";
}

function baseUrl(): string {
  return isLive()
    ? "https://api.alpaca.markets"
    : "https://paper-api.alpaca.markets";
}

async function alpaca<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(baseUrl() + path, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID ?? "",
      "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Alpaca ${res.status} ${path}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export interface AlpacaAccount {
  equity: string;
  last_equity: string; // equity à la clôture précédente → base du P&L du jour
  cash: string;
  buying_power: string;
  status: string;
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  side: string;
}

export interface AlpacaOrder {
  id: string;
  symbol: string;
  side: string;
  qty: string | null;
  filled_qty: string;
  type: string;
  status: string;
  submitted_at: string;
  filled_avg_price: string | null;
}

export const getAccount = () => alpaca<AlpacaAccount>("/v2/account");

export const getPositions = () => alpaca<AlpacaPosition[]>("/v2/positions");

export const getOrders = (limit = 20) =>
  alpaca<AlpacaOrder[]>(`/v2/orders?status=all&limit=${limit}&direction=desc`);

/** Achat au marché + ordre stop de protection attaché (OTO). */
export function submitBuyWithStop(symbol: string, qty: number, stop: number) {
  return alpaca<AlpacaOrder>("/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol,
      qty: String(qty),
      side: "buy",
      type: "market",
      time_in_force: "day",
      order_class: "oto",
      stop_loss: { stop_price: stop.toFixed(2) },
    }),
  });
}

/** Liquide la position (et annule les ordres stop associés). */
export function closePosition(symbol: string) {
  return alpaca<AlpacaOrder>(
    `/v2/positions/${encodeURIComponent(symbol)}?cancel_orders=true`,
    { method: "DELETE" }
  );
}

/* ─── Exécution pro (Phase 1) ──────────────────────────────────────────────
 * Méthodes disponibles pour les futures stratégies. La stratégie RSI-2 actuelle
 * continue d'utiliser submitBuyWithStop (market + stop) car elle sort sur signal
 * (clôture > MM5), pas sur un take-profit fixe.
 */

/** Achat bracket (OCO) : entrée au marché + stop de protection + take-profit. */
export function submitBracketBuy(
  symbol: string,
  qty: number,
  stop: number,
  takeProfit: number
) {
  return alpaca<AlpacaOrder>("/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol,
      qty: String(qty),
      side: "buy",
      type: "market",
      time_in_force: "day",
      order_class: "bracket",
      stop_loss: { stop_price: stop.toFixed(2) },
      take_profit: { limit_price: takeProfit.toFixed(2) },
    }),
  });
}

/** Ordre d'achat à cours limité (ne s'exécute qu'au prix voulu ou mieux). */
export function submitLimitBuy(symbol: string, qty: number, limit: number) {
  return alpaca<AlpacaOrder>("/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol,
      qty: String(qty),
      side: "buy",
      type: "limit",
      limit_price: limit.toFixed(2),
      time_in_force: "day",
    }),
  });
}

/** Stop suiveur sur une position détenue (protège les gains en tendance). */
export function submitTrailingStopSell(
  symbol: string,
  qty: number,
  trailPercent: number
) {
  return alpaca<AlpacaOrder>("/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol,
      qty: String(qty),
      side: "sell",
      type: "trailing_stop",
      trail_percent: String(trailPercent),
      time_in_force: "gtc",
    }),
  });
}
