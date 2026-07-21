---
name: backtest
description: >
  Lance l'agent quant : backtests du Signal Bot US (npm run bot:backtest), analyse de la
  stratégie RSI-2 et propositions d'évolution chiffrées. Utiliser quand Cyril veut évaluer
  ou ajuster la stratégie, ou tape /backtest [variante ou question].
---

# /backtest — stratégie & backtests du Signal Bot US

Réponds à la demande : `$ARGUMENTS`

1. Lis `.claude/agents/quant.md` et `CLAUDE.md`.
2. Si l'agent `quant` est disponible comme sous-agent, délègue-lui via le tool Agent
   (subagent_type: `quant`). Sinon, applique toi-même ses instructions.
3. Workflow : lancer `npm run bot:backtest` (ou la variante demandée), interpréter les
   résultats (taux de réussite, drawdown, nombre de trades), comparer aux paramètres
   actuels, conclure avec les limites (in-sample, pas de garantie, risque de
   sur-ajustement).

Toute proposition d'évolution reste une proposition à valider par Cyril — rien n'est
appliqué en production par ce skill, et jamais de promesse de performance.
