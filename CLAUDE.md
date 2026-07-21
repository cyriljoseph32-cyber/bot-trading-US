# Signal Bot — Actifs US

Bot de signaux de trading sur actifs US (SPY, QQQ, DIA, IWM + 16 grandes valeurs),
stratégie retour à la moyenne RSI-2, dashboard sur `/trading.html`. React 19 + Vite +
TypeScript, déployé sur Vercel. Deux moteurs :

1. **Bot quotidien** — cron Vercel `/api/cron` chaque jour de bourse à 21h35 UTC : analyse
   de la watchlist, email récapitulatif (Resend), ordres automatiques optionnels chez
   Alpaca (`AUTOTRADE`). **Paper trading par défaut** — le réel exige explicitement
   `ALPACA_LIVE=true` ; ne jamais l'activer sans décision explicite de Cyril.
2. **Bot global multi-actifs temps réel** (`bot/`, flux WebSocket Twelve Data) :
   `npm run bot:paper` — voir `bot/README.md`.

## Commandes

- `npm run dev` — dev server (dashboard : http://localhost:5173/trading.html)
- `npm run build` — `tsc -b && vite build`
- `npm run typecheck` · `npm run lint` · `npm run test:run` (Vitest)
- `npm run bot:paper` · `npm run bot:backtest` — bot global (tsx)

## Règles

- `/api/positions` et `/api/chat` exigent `DASHBOARD_TOKEN` (sinon 401/503). L'assistant
  consomme la clé Anthropic — ne jamais l'exposer sans token.
- `MAX_DAILY_LOSS_PCT` est un filtre d'entrée (le cron tourne 1×/jour), pas une protection
  intra-day — la vraie protection est le stop attaché géré par Alpaca.
- Jamais de promesse de performance : les taux affichés sont historiques, nets de frais,
  sans garantie — l'avertissement « pas un conseil en investissement » reste visible sur le
  dashboard et dans les emails.
- Variables d'environnement : voir le tableau du `README.md` (Resend, Alpaca, risque).
- `api/market.ts` = proxy Yahoo Finance en production ; en dev local, le proxy Vite
  (`vite.config.ts`) fait le même travail.

## L'équipe d'agents

| Agent | Rôle | Raccourci |
|---|---|---|
| `trading-ops` (`.claude/agents/trading-ops.md`) | Exploitation : signaux, positions paper, santé du cron/emails, audit sécurité & config | `/trading` |
| `quant` (`.claude/agents/quant.md`) | Stratégie RSI-2, backtests, propositions d'évolution chiffrées | `/backtest` |
| `dev-trading` (`.claude/agents/dev-trading.md`) | Code : dashboard, API Vercel, bot temps réel — typecheck + lint + tests avant push | `/bot-dev` |

Règles communes : français avec Cyril ; **jamais de conseil en investissement ni de promesse
de performance** ; **jamais `ALPACA_LIVE` ni `AUTOTRADE`** sans décision explicite de Cyril ;
zéro invention (`[À COMPLÉTER PAR CYRIL]`) ; chaque agent lit la fiche mémoire du projet
avant d'agir et met à jour la mémoire centrale après une session significative.

## Mémoire centrale

La mémoire transverse des projets de Cyril vit dans le dépôt
`cyriljoseph32-cyber/Coconut-Samui-Rugby-Academy`, dossier `brain/memoire/` — la fiche de ce
projet est `brain/memoire/projets/bot-trading-us.md`. Au début d'une tâche, la consulter si
elle est accessible (checkout voisin `/home/user/Coconut-Samui-Rugby-Academy/` ou via
GitHub). Après un changement majeur ici, mettre à jour la fiche + `brain/memoire/journal.md`,
ou le signaler à Cyril pour que l'agent `memory` s'en charge.
