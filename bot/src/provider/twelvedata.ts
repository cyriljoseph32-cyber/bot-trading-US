/* ─── Fournisseur Twelve Data (WebSocket + REST) ───────────────────────────
 *
 * Flux temps réel : wss://ws.twelvedata.com/v1/quotes/price
 *   • souscription par lots, heartbeat périodique, reconnexion avec backoff
 *     exponentiel + jitter, détection de flux mort par timeout d'événements ;
 *   • parsing des messages isolé dans parseTdMessage (pur, testé sans socket).
 *
 * REST : time_series (historique) et quote (stats), protégés par un token
 * bucket calé sur les crédits/minute du plan (8/min en offre gratuite).
 *
 * La clé API ne circule QUE côté serveur (env) — jamais vers le dashboard.
 */

import type { Bar, Instrument, Quote, Timeframe } from "../types";
import type { FeedStatus, MarketDataProvider, ProviderEvents } from "./provider";
import type { SymbolStats } from "../universe";
import { backoffDelayMs, chunkSymbols, HeartbeatMonitor, RateLimiter } from "../feed";
import { isStale } from "../sessions";
import { logger } from "../log";

const WS_URL = "wss://ws.twelvedata.com/v1/quotes/price";
const REST_URL = "https://api.twelvedata.com";
const HEARTBEAT_SEND_MS = 10_000;
const HEARTBEAT_DEAD_MS = 45_000;
const SUBSCRIBE_BATCH = 50;

/** Message « price » brut du WebSocket Twelve Data. */
interface TdPriceEvent {
  event?: string;
  symbol?: string;
  price?: number;
  bid?: number;
  ask?: number;
  day_volume?: number | string;
  timestamp?: number; // secondes epoch
}

export type ParsedTdMessage =
  | { kind: "quote"; quote: Quote }
  | { kind: "heartbeat" }
  | { kind: "status"; detail: string }
  | { kind: "ignored" };

/** Parse un message WS Twelve Data → Quote normalisée (pur, testable). */
export function parseTdMessage(
  raw: string,
  instruments: Map<string, Instrument>,
  now: number = Date.now()
): ParsedTdMessage {
  let msg: TdPriceEvent;
  try {
    msg = JSON.parse(raw) as TdPriceEvent;
  } catch {
    return { kind: "ignored" };
  }

  if (msg.event === "heartbeat") return { kind: "heartbeat" };
  if (msg.event === "subscribe-status" || msg.event === "unsubscribe-status") {
    return { kind: "status", detail: JSON.stringify(msg) };
  }
  if (msg.event !== "price" || !msg.symbol || typeof msg.price !== "number" || !Number.isFinite(msg.price) || msg.price <= 0) {
    return { kind: "ignored" };
  }

  const inst = instruments.get(msg.symbol);
  if (!inst) return { kind: "ignored" };

  // Twelve Data envoie le timestamp en SECONDES epoch UTC.
  const ts = typeof msg.timestamp === "number" && msg.timestamp > 0 ? msg.timestamp * 1000 : now;
  const volume = msg.day_volume !== undefined ? Number(msg.day_volume) : null;

  const quote: Quote = {
    symbol: inst.symbol,
    assetClass: inst.assetClass,
    exchange: inst.exchange,
    currency: inst.currency,
    bid: typeof msg.bid === "number" && msg.bid > 0 ? msg.bid : null,
    ask: typeof msg.ask === "number" && msg.ask > 0 ? msg.ask : null,
    last: msg.price,
    volume: volume !== null && Number.isFinite(volume) ? volume : null,
    ts,
    stale: isStale(inst.assetClass, inst.exchange, ts, now),
  };
  return { kind: "quote", quote };
}

/** Mappe nos timeframes vers les intervalles Twelve Data. */
const TD_INTERVAL: Record<Timeframe, string> = { "1m": "1min", "5m": "5min", "15m": "15min" };

interface TdTimeSeriesResponse {
  status?: string;
  message?: string;
  values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume?: string }>;
}

/** Parse la réponse REST time_series → bougies normalisées (pur, testable). */
export function parseTdTimeSeries(data: TdTimeSeriesResponse, symbol: string, tf: Timeframe): Bar[] {
  if (data.status === "error" || !Array.isArray(data.values)) {
    throw new Error(`Twelve Data time_series ${symbol}: ${data.message ?? "réponse invalide"}`);
  }
  return data.values
    .map((v) => ({
      symbol,
      tf,
      // datetime "YYYY-MM-DD HH:mm:ss" en UTC (timezone=UTC demandé à l'API)
      openTime: Date.parse(v.datetime.replace(" ", "T") + "Z"),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: v.volume !== undefined ? Number(v.volume) : 0,
      ticks: 0,
    }))
    .filter((b) => Number.isFinite(b.openTime) && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.openTime - b.openTime);
}

export class TwelveDataProvider implements MarketDataProvider {
  readonly name = "twelvedata";

  private ws: WebSocket | null = null;
  private currentStatus: FeedStatus = "unconfigured";
  private events: ProviderEvents | null = null;
  private instruments = new Map<string, Instrument>();
  private reconnectAttempt = 0;
  private stopped = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private monitor = new HeartbeatMonitor(HEARTBEAT_DEAD_MS);
  private limiter: RateLimiter;

  constructor(private readonly apiKey: string | undefined, restRpm: number) {
    this.limiter = new RateLimiter(restRpm);
  }

  status(): FeedStatus {
    return this.currentStatus;
  }

  start(instruments: Instrument[], events: ProviderEvents): void {
    this.events = events;
    this.instruments = new Map(instruments.map((i) => [i.symbol, i]));
    this.stopped = false;
    if (!this.apiKey) {
      this.setStatus("unconfigured", "TWELVEDATA_API_KEY absente — flux temps réel désactivé");
      return;
    }
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.setStatus("closed");
  }

  private setStatus(status: FeedStatus, detail?: string): void {
    this.currentStatus = status;
    this.events?.onStatus(status, detail);
    if (detail) logger.info("feed", `${status} — ${detail}`);
  }

  private connect(): void {
    this.setStatus(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");
    const ws = new WebSocket(`${WS_URL}?apikey=${this.apiKey}`);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.monitor.touch();
      this.setStatus("connected", `${this.instruments.size} symboles`);
      // Souscription par lots pour ne pas dépasser la taille de message.
      for (const batch of chunkSymbols([...this.instruments.keys()], SUBSCRIBE_BATCH)) {
        ws.send(JSON.stringify({ action: "subscribe", params: { symbols: batch.join(",") } }));
      }
      // Heartbeat sortant + détection de flux mort.
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        if (this.monitor.isDead()) {
          logger.warn("feed", "aucun événement reçu — reconnexion forcée");
          ws.close();
          return;
        }
        try {
          ws.send(JSON.stringify({ action: "heartbeat" }));
        } catch {
          /* la fermeture déclenchera onclose */
        }
      }, HEARTBEAT_SEND_MS);
    };

    ws.onmessage = (ev: MessageEvent) => {
      this.monitor.touch();
      const parsed = parseTdMessage(String(ev.data), this.instruments);
      if (parsed.kind === "quote") this.events?.onQuote(parsed.quote);
      else if (parsed.kind === "status") logger.debug("feed", parsed.detail);
    };

    ws.onerror = () => {
      /* onclose suit toujours ; le log se fait là */
    };

    ws.onclose = () => {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      if (this.stopped) return;
      const delay = backoffDelayMs(this.reconnectAttempt);
      this.reconnectAttempt += 1;
      this.setStatus("reconnecting", `tentative ${this.reconnectAttempt} dans ${Math.round(delay / 1000)}s`);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  /* ─── REST ─────────────────────────────────────────────────────────── */

  private async rest<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!this.apiKey) throw new Error("TWELVEDATA_API_KEY absente");
    await this.limiter.acquire();
    const qs = new URLSearchParams({ ...params, apikey: this.apiKey });
    const res = await fetch(`${REST_URL}${path}?${qs}`);
    if (!res.ok) throw new Error(`Twelve Data ${res.status} ${path}`);
    return res.json() as Promise<T>;
  }

  async fetchHistory(instrument: Instrument, tf: Timeframe, count: number): Promise<Bar[]> {
    const data = await this.rest<TdTimeSeriesResponse>("/time_series", {
      symbol: instrument.symbol,
      interval: TD_INTERVAL[tf],
      outputsize: String(Math.min(count, 5000)),
      timezone: "UTC",
    });
    return parseTdTimeSeries(data, instrument.symbol, tf);
  }

  async fetchStats(instruments: Instrument[]): Promise<Record<string, SymbolStats>> {
    const out: Record<string, SymbolStats> = {};
    for (const inst of instruments) {
      try {
        const q = await this.rest<{ average_volume?: string; close?: string }>("/quote", {
          symbol: inst.symbol,
        });
        const avgVol = Number(q.average_volume);
        const close = Number(q.close);
        out[inst.symbol] = {
          avgDollarVolume:
            Number.isFinite(avgVol) && Number.isFinite(close) ? avgVol * close : undefined,
          validData: Number.isFinite(close) && close > 0,
        };
      } catch (e) {
        out[inst.symbol] = { validData: false };
        logger.warn("universe", `stats indisponibles pour ${inst.symbol}: ${String(e)}`);
      }
    }
    return out;
  }
}
