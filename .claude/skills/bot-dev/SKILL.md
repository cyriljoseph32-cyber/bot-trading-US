---
name: bot-dev
description: >
  Lance l'agent dev-trading : modifications de code du Signal Bot US (dashboard React/Vite,
  API Vercel, bot temps réel) avec typecheck + lint + tests avant tout commit. Utiliser
  quand Cyril demande un changement de code sur le bot ou tape /bot-dev [demande].
---

# /bot-dev — développement du Signal Bot US

Réponds à la demande : `$ARGUMENTS`

1. Lis `.claude/agents/dev-trading.md` et `CLAUDE.md`.
2. Si l'agent `dev-trading` est disponible comme sous-agent, délègue-lui via le tool Agent
   (subagent_type: `dev-trading`). Sinon, applique toi-même ses instructions.
3. Workflow : branche de travail → modification → `npm run typecheck` &&
   `npm run lint` && `npm run test:run` → commit clair → signaler à Cyril ce qui a changé
   (et mettre à jour la mémoire centrale si le changement est significatif).

Jamais de push direct sur `main` ; les protections de sécurité ne sont jamais affaiblies.
