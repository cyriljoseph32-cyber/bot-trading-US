# Bot global multi-actifs (temps réel)

Extension du Signal Bot US : analyse **temps réel** d'actions mondiales et de
paires FX (crypto optionnelle), avec pipeline de signaux explicables, moteur de
risque strict et **paper trading par défaut**. Processus Node autonome (le
dashboard Vercel existant n'est pas touché).

## Sécurité — à lire d'abord

- **Aucun ordre réel ne peut partir de ce dépôt.** Le routeur d'ordres exige
  `LIVE_TRADING=true` **ET** un adaptateur de courtier réel explicitement
  branché (`bot/src/exec/router.ts`). Aucun adaptateur réel n'est fourni :
  par construction, tout finit en paper trading.
- Les clés API restent dans l'environnement, côté serveur. Le dashboard ne
  reçoit que des données calculées.
- Les SORTIES (stop, take-profit) ne sont jamais bloquées par le risque ;
  seules les ENTRÉES le sont.

## Démarrage

```bash
npm install
cp .env.example .env       # renseigner TWELVEDATA_API_KEY
npm run bot:paper          # démarre le bot en mode analyse + paper
# Dashboard : http://127.0.0.1:8787
```

Sans `TWELVEDATA_API_KEY`, le bot démarre en mode dégradé : dashboard et API
répondent, flux `unconfigured`. Utile pour valider l'installation.

```bash
npm run bot:backtest                        # backtest sur échantillon synthétique
npm run bot:backtest -- data/bars-2026-07-16.jsonl   # ou sur bougies persistées
npm run test:run                            # tests unitaires (feed, risque, paper…)
```

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `TWELVEDATA_API_KEY` | — | Clé API Twelve Data (WS + REST). Requise pour les données réelles. |
| `LIVE_TRADING` | (off) | `true` = autorise un adaptateur réel. **Ne l'activez pas** sans adaptateur ni checklist ci-dessous. |
| `BASE_CURRENCY` | `USD` | Devise de base du P&L papier. |
| `PAPER_CAPITAL` | `100000` | Capital de départ papier. |
| `BOT_PORT` / `BOT_BIND` | `8787` / `127.0.0.1` | Écoute du dashboard/API. |
| `TD_REST_RPM` | `8` | Crédits REST/minute de votre plan Twelve Data. |
| `TD_WS_SYMBOL_LIMIT` | `8` | Symboles simultanés sur le WebSocket de votre plan. |
| `UNIVERSE_DYNAMIC` | (off) | `true` = reclasse l'univers par liquidité via l'API (coûte des crédits). |
| `BOT_DATA_DIR` | `data` | Répertoire JSONL (bougies, signaux, ordres). |
| `KILL_SWITCH` | (off) | `true` = aucune nouvelle entrée au démarrage (togglable via l'API/dashboard). |

## Limites du fournisseur (Twelve Data)

- **Offre gratuite** : ~8 crédits REST/minute, ~800/jour, 8 symboles WebSocket.
  Avec les défauts (`TD_WS_SYMBOL_LIMIT=8`), le bot suit le benchmark + 7
  instruments. Les plans payants montent à 1500+ symboles WS : ajustez les
  deux variables `TD_*` selon votre plan.
- L'amorçage d'historique (200 bougies 15m par instrument) consomme 1 crédit
  REST par instrument, étalé par le limiteur de débit intégré.

## Univers

Configuré dans `bot/config/universe.json` — rien n'est codé en dur :
seeds d'actions par région (US, Canada, UK, zone euro, Suisse, Nordiques,
Japon, HK/Chine, Inde, Australie, Singapour, Corée, Brésil, Mexique, Afrique
du Sud), FX majeures + crosses + émergentes, crypto (liste vide par défaut).
Critères de sélection (`selection`) : topN par région, volume-dollar minimum,
spread maximum, exclusions. `UNIVERSE_DYNAMIC=true` reclasse par liquidité
réelle via l'API.

## Architecture

```
bot/src/
├── provider/       # interface MarketDataProvider + implémentation Twelve Data
├── feed.ts         # backoff, heartbeat, batching, rate limiting (pur)
├── sessions.ts     # calendriers de marché en UTC (actions/FX/crypto)
├── bars.ts         # ticks → bougies 1m/5m/15m, dédup, aberrations, trous
├── store.ts        # persistance JSONL (+ schéma Postgres : supabase/migrations/0002)
├── strategy/       # pipeline explicable : tendance, momentum, vol, volume,
│                   # spread, corrélation, régime → score/confiance/raisons
├── risk/           # sizing par ATR, plafonds pays/devise/secteur, perte max,
│                   # kill switch, disjoncteur
├── exec/           # PaperBroker (idempotent, coûts, FX) + routeur LIVE_TRADING
├── backtest.ts     # MÊME pipeline/risque/broker rejoués sur l'historique
└── server.ts       # dashboard mobile + API JSON (127.0.0.1:8787)
```

Remplacer Twelve Data par IBKR/un courtier : implémenter `MarketDataProvider`
(`bot/src/provider/provider.ts`) et, pour l'exécution, `BrokerAdapter`
(`bot/src/exec/broker.ts`), puis les brancher dans `bot/src/index.ts`.

## Checklist AVANT tout passage en réel

1. ≥ 4 semaines de paper trading avec P&L, slippage et rejets de risque revus.
2. Backtest sur VOS données persistées (pas l'échantillon synthétique) — en
   gardant en tête le **biais du survivant** : l'univers actuel surestime.
3. Implémenter et tester un `BrokerAdapter` réel sur le compte démo du courtier.
4. Vérifier chaque plafond de risque (`bot/src/risk/engine.ts`) contre votre
   tolérance réelle ; tester le kill switch et le disjoncteur en conditions.
5. Alerte externe sur `/api/health` (flux mort) et `/api/pnl` (perte du jour).
6. Seulement alors : `LIVE_TRADING=true` + adaptateur branché, taille minimale.
