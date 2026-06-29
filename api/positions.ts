export const config = { runtime: "edge" };

import {
  alpacaConfigured,
  getAccount,
  getOrders,
  getPositions,
  isLive,
} from "./_lib/alpaca";
import { checkDashboardAuth, unauthorizedResponse } from "./_lib/auth";
import { integrationStatus } from "./_lib/env";

/* ─── Suivi du compte courtier pour le dashboard ──────────────────────────
 * GET /api/positions → état du compte Alpaca (positions, ordres récents).
 * Protégé par DASHBOARD_TOKEN dès qu'il est défini (cf. _lib/auth.ts).
 */

export default async function handler(req: Request) {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Sécurité : données de compte sensibles → exige le token si configuré.
  const auth = checkDashboardAuth(req, { failClosed: true });
  if (!auth.ok) return unauthorizedResponse(auth.reason!);

  const status = integrationStatus();
  const base = {
    configured: alpacaConfigured(),
    live: isLive(),
    autotrade: status.autotrade,
    emailConfigured: status.email,
    authProtected: status.authProtected,
  };

  if (!base.configured) {
    return new Response(JSON.stringify(base), {
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const [account, positions, orders] = await Promise.all([
      getAccount(),
      getPositions(),
      getOrders(10),
    ]);
    return new Response(
      JSON.stringify({
        ...base,
        account: {
          equity: Number(account.equity),
          cash: Number(account.cash),
          buyingPower: Number(account.buying_power),
          status: account.status,
        },
        positions: positions.map((p) => ({
          symbol: p.symbol,
          qty: Number(p.qty),
          avgEntry: Number(p.avg_entry_price),
          current: Number(p.current_price),
          marketValue: Number(p.market_value),
          pnl: Number(p.unrealized_pl),
          pnlPct: Number(p.unrealized_plpc) * 100,
        })),
        orders: orders.map((o) => ({
          symbol: o.symbol,
          side: o.side,
          qty: Number(o.filled_qty) || Number(o.qty ?? 0),
          type: o.type,
          status: o.status,
          submittedAt: o.submitted_at,
          fillPrice: o.filled_avg_price ? Number(o.filled_avg_price) : null,
        })),
      }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        ...base,
        error: e instanceof Error ? e.message : "Erreur Alpaca",
      }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }
}
