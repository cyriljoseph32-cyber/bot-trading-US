export const config = { runtime: "edge" };

// Proxy vers Yahoo Finance (données journalières, sans clé API).
// GET /api/market?symbol=SPY&range=2y
const SYMBOL_RE = /^[A-Z0-9.^-]{1,12}$/;
const RANGES = new Set(["6mo", "1y", "2y", "5y"]);

export default async function handler(req: Request) {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  const range = url.searchParams.get("range") ?? "2y";

  if (!SYMBOL_RE.test(symbol) || !RANGES.has(range)) {
    return new Response(JSON.stringify({ error: "Invalid params" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol
      )}?range=${range}&interval=1d`,
      { headers: { "user-agent": "Mozilla/5.0 (compatible; SignalBot/1.0)" } }
    );
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: {
        "content-type": "application/json",
        // cache CDN 5 min : évite de marteler Yahoo à chaque rafraîchissement
        "cache-control": "s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Upstream error" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
