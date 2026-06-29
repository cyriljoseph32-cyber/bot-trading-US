# Déploiement & changelog — Signal Bot US

## Ce qui a été construit et vérifié

### Phase 0 — Fondations (livrée, testée)
- **Nettoyage** : code mort « Coco » supprimé, entrée du site repointée vers le bot, `package.json` renommé, `.env` ignoré par git.
- **Sécurité (R1 corrigé)** : `/api/positions` exige `DASHBOARD_TOKEN` (comparaison à temps constant) ; porte de saisie + avertissement dans le dashboard.
- **Tests du code « argent »** : 16 tests (indicateurs, stratégie, sizing) — **verts**. CI GitHub Actions (lint + test + build).
- **Base de données** : schéma Supabase (`runs`, `signals`, `orders`, `account_snapshots`, `config`, RLS verrouillé) + journal écrit par le cron (best-effort, ne bloque jamais le trading).

### Phase 1 — Risque & exécution pro (livrée, testée)
- **Moteur de risque** (`src/trading/risk.ts`, pur & testé — 15 tests) : kill switch, perte max quotidienne (halte des entrées, **sorties toujours autorisées**), max positions, max trades/jour, plafond de concentration.
- **Intégration cron** : chaque entrée passe par le moteur ; rejets journalisés ; compteurs mis à jour à la volée.
- **Exécution pro** (`api/_lib/alpaca.ts`) : ordre bracket (stop + take-profit), trailing stop, ordre limite — disponibles pour les futures stratégies.

**Tests : 31/31 verts. Syntaxe serveur validée.**

---

## Runbook de déploiement (≈ 5 min, ton action)

> Je ne peux pas pousser sur ton GitHub/Vercel/Supabase ni saisir tes secrets à ta place — ce sont tes accès. Voici les étapes exactes.

### 1. Base de données Supabase
Dans le projet `tiwzzptejtxqwrssnynh` → **SQL Editor** → colle `supabase/migrations/0001_init.sql` → **Run**.
Vérifie dans **Table Editor** que les 5 tables existent.

### 2. Variables d'environnement Vercel
Projet **bot-trading-us** → Settings → Environment Variables :

| Variable | Valeur |
|---|---|
| `DASHBOARD_TOKEN` | une valeur aléatoire : `openssl rand -hex 32` |
| `SUPABASE_URL` | `https://tiwzzptejtxqwrssnynh.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | clé service_role (Supabase → Settings → API) |

(Déjà en place si configurés : `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `RESEND_API_KEY`, `ALERT_EMAIL`, `CRON_SECRET`.)
Risque optionnel : `MAX_DAILY_LOSS_PCT`, `MAX_OPEN_POSITIONS`, `MAX_TRADES_PER_DAY`, `MAX_POSITION_PCT`, `KILL_SWITCH` (sinon défauts prudents 3 % / 5 / 3 / 20 %).

### 3. Pousser le code
En local, dans le dossier du projet :
```bash
npm install                 # récupère Vitest + régénère le lockfile
npm run test:run            # 31/31 doivent passer
git add -A
git commit -m "Phase 0 + 1 : fondations, sécurité, journal, moteur de risque"
git push
```
Vercel redéploie automatiquement.

### 4. Confirmer que le journal se remplit
- Vercel → projet → onglet **Cron** → exécute `/api/cron` une fois (envoie le `CRON_SECRET` automatiquement).
- La réponse JSON doit contenir `"journaled": true`.
- Supabase → Table Editor → `runs` : une ligne ; `signals` : ~20 lignes.

> Rappel sécurité : tant que `DASHBOARD_TOKEN` n'est pas posé, `/api/positions` reste ouvert. C'est la première chose à faire.

---

## Phases 2-6 — cerveau analytique (livré, testé, déployé)

**48 tests Vitest verts.** Code pur, déployé en production le 29 juin 2026.

- **Phase 2 (socle)** — `volume` ajouté aux bougies et aux récupérations (Yahoo) côté serveur et client. *Reste : fournisseur intraday Alpaca IEX + multi-timeframe (1m…1H) — infra à venir.*
- **Phase 3** — `src/trading/detectors.ts` : détecteurs tendance, cassure, momentum, volatilité, volume, retournement (5 tests). *Reste : exécuter 