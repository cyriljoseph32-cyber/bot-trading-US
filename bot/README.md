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

## SPC FX5 Multi-Asset 100 (stratégie H1 trend-following)

Seconde stratégie, avec son propre point d'entrée. Le bot 15m ci-dessus n'est
pas modifié — ce sont deux processus indépendants qui partagent les mêmes
briques (provider, bougies, sessions, risque, paper broker, backtest).

```bash
npm run bot:spcfx5              # scan H1 + paper trading (dashboard :8787)
npm run bot:spcfx5-backtest     # échantillon synthétique déterministe
npm run bot:spcfx5-backtest -- data/bars-2026-08-22.jsonl   # ou vos bougies H1
```

### Philosophie

Suivre une tendance confirmée, jamais la prédire ; ne pas entrer sur un signal
ambigu. Une entrée exige l'alignement **simultané** de tout ce qui suit, à la
**clôture** d'une bougie H1 (jamais pendant sa formation) :

| # | Condition (LONG ; SHORT symétrique) |
|---|---|
| 1 | clôture au-dessus de la SMA 200 |
| 2 | SMA 200 orientée à la hausse (pente ≥ seuil) |
| 3 | DI+ > DI-, avec un écart minimal |
| 4 | ADX au-dessus du seuil |
| 5 | bascule UT Bot haussière confirmée à la clôture |
| 6 | *(option)* H4 haussier, *(option)* D1 haussier |
| 7 | *(option)* breakout confirmé au-delà du range des N bougies + buffer |

Un seul critère manquant ⇒ pas d'entrée, avec le **code de rejet exact**.

### Score de qualité /100

Tous les signaux ne se valent pas. Chaque setup reçoit une note, **détaillée
composant par composant** (`/api/spcfx5/signals` renvoie le détail, jamais un
score opaque) :

| Composant | Pts | Mesure |
|---|---|---|
| Alignement prix / SMA 200 | 20 | distance normalisée en ATR |
| Pente SMA 200 | 15 | pente % vs seuil |
| Force ADX | 20 | palier entre `minAdx` et `strongAdx` |
| Écart DI+/DI- | 10 | `\|DI+ − DI-\| / (DI+ + DI-)` |
| Qualité UT Bot | 15 | fraîcheur de la bascule + marge au stop |
| Volatilité ATR | 10 | position dans la bande de la catégorie |
| Coût / liquidité / session | 10 | RR net de coûts, volume, séance |

Seuil d'éligibilité par défaut : **70/100** (`params.minScore`).

### Filtres (tous activables/désactivables)

Volatilité (bande ATR% par catégorie) · coût d'exécution (**RR calculé net de
spread, commissions et slippage**) · volume (absence de volume FX signalée
explicitement, jamais pénalisée) · session (Londres/New York pour le FX, séance
de l'exchange pour les actions et indices, 24/7 crypto) · annonces macro
(blocage X min avant / Y min après ; **ne ferme jamais une position** sauf
`closePositionsOnNews`) · anti-chop (ADX, pente, distance minimale à la SMA).

### Risque

**Par position** — risque fixe en % de l'equity, stop = la plus large des deux
références (ATR × coefficient, et niveau technique : swing ou ligne UT Bot),
borné par `minAtrMult`/`maxAtrMult` (hors bande ⇒ rejet). Take-profit au ratio
configuré, break-even à +1R, trailing au-delà de +1,5R.

**Portefeuille** (`bot/src/risk/portfolio.ts`) — max de positions ouvertes,
max par catégorie, risque cumulé ouvert, budget de risque du jour, perte
quotidienne et hebdomadaire, nombre d'entrées par jour, cooldown après une
série de pertes. Deux **interdits durs, non désactivables** : jamais de
renforcement dans le sens d'une position ouverte (pas de moyenne à la baisse)
et la taille ne dépend **jamais** des pertes passées (pas de martingale).

**Corrélation** — chaque actif déclare ses groupes avec le **signe du pari** :
`usd:-1` sur EURUSD signifie « long EURUSD = short USD ». Long EURUSD et short
USDCHF sont donc reconnus comme un même pari et partagent le plafond du groupe
`usd`. Un signal nettement meilleur peut forcer un groupe saturé, mais **en
taille réduite** (`correlationOverrideScoreDelta` / `…SizeMult`).

### Univers

`bot/config/spcfx5.json` — 100 actifs (FX majeures/mineures/exotiques, indices,
métaux, énergie, agricoles, grandes capitalisations, ETF, crypto). Chaque entrée
porte `std` (symbole standard) **et** `provider` (symbole attendu par l'API).

> ⚠ **Aucun ticker n'est supposé exister chez votre courtier.** Les actifs dont
> la disponibilité n'est pas certaine sont livrés `enabled: false` avec une note
> `[À VÉRIFIER CHEZ LE COURTIER]` — 77 des 100 sont actifs par défaut. Vérifiez
> chez votre courtier avant d'en activer d'autres ; `/api/spcfx5/universe`
> montre à tout moment qui est suivi et qui est écarté, avec la raison.

### Cadence et crédits API

L'entrée n'ayant lieu qu'à la clôture H1, le bot **sonde le REST** (pas de
WebSocket, limité à 8 symboles en offre gratuite). H4 et D1 sont **agrégés
localement** depuis les bougies H1 closes : aucun crédit supplémentaire, et
aucun lookahead possible.

> ⚠ 100 actifs = ~100 crédits REST/heure (**~2 400/jour**). L'offre gratuite
> Twelve Data plafonne à 800/jour : baissez `SPC_MAX_SYMBOLS` ou prenez un plan
> payant. Le bot affiche son budget estimé au démarrage.

### API

| Route | Contenu |
|---|---|
| `GET /api/spcfx5/signals` | classement complet : rang, score détaillé, décision portefeuille |
| `GET /api/spcfx5/rejects` | setups écartés, avec le code de rejet exact |
| `GET /api/spcfx5/universe` | actifs suivis et actifs ignorés, avec la raison |
| `GET /api/spcfx5/portfolio` | état du gouverneur : risque ouvert, pertes, cooldown |

`SPC_WEBHOOK_URL` publie en plus les signaux retenus en JSON structuré.

### Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `SPC_CONFIG` | `bot/config/spcfx5.json` | Watchlist et paramètres. |
| `SPC_MAX_SYMBOLS` | `100` | Plafond d'actifs scannés (budget de crédits). |
| `SPC_NEWS_FILE` | — | Annonces macro (`bot/config/news.example.json`). Absent = filtre neutre. |
| `SPC_SESSION_FILTER` | actif | `false` désactive le filtre de session (backtest). |
| `SPC_WEBHOOK_URL` | — | Publication des signaux retenus. |

### Limites à garder en tête

- Le **spread est estimé** à partir des coûts configurés quand il n'est pas
  coté : les signaux le signalent (`spread_unknown`), ce n'est pas une mesure.
- Le **chemin intra-bougie** est reconstitué de façon conservatrice (stop avant
  take-profit si les deux tombent dans la même bougie) — une approximation.
- Le backtest sur l'univers actuel souffre du **biais du survivant**.
- Les scores et résultats sont **indicatifs, jamais une promesse de
  performance**, et ne constituent pas un conseil en investissement.

## Checklist AVANT tout passage en réel

1. ≥ 4 semaines de paper trading avec P&L, slippage et rejets de risque revus.
2. Backtest sur VOS données persistées (pas l'échantillon synthétique) — en
   gardant en tête le **biais du survivant** : l'univers actuel surestime.
3. Implémenter et tester un `BrokerAdapter` réel sur le compte démo du courtier.
4. Vérifier chaque plafond de risque (`bot/src/risk/engine.ts`) contre votre
   tolérance réelle ; tester le kill switch et le disjoncteur en conditions.
5. Alerte externe sur `/api/health` (flux mort) et `/api/pnl` (perte du jour).
6. Seulement alors : `LIVE_TRADING=true` + adaptateur branché, taille minimale.
