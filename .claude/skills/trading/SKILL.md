---
name: trading
description: >
  Lance l'agent trading-ops : état des lieux du Signal Bot US — signaux, positions paper,
  santé du cron et des emails, audit sécurité/config. Utiliser quand Cyril demande où en
  est le bot ou tape /trading [question optionnelle].
---

# /trading — état des lieux du Signal Bot US

Réponds à la demande : `$ARGUMENTS`

1. Lis `.claude/agents/trading-ops.md` et `CLAUDE.md`.
2. Si l'agent `trading-ops` est disponible comme sous-agent, délègue-lui via le tool Agent
   (subagent_type: `trading-ops`). Sinon, applique toi-même ses instructions.
3. Structure fixe, en français, une page max :
   - 📊 Signaux & positions (paper) — ce que le bot voit/détient, d'après le code et le
     dashboard
   - ⚙️ Santé du système — cron 21h35 UTC, emails Resend, proxy Yahoo, données à jour ?
   - 🔒 Sécurité & config — variables présentes/cohérentes, rappels (paper par défaut)
   - ✅ Actions recommandées (3 max)

Jamais de conseil en investissement ; les états non vérifiables (Vercel, compte Alpaca)
sont marqués `[À COMPLÉTER PAR CYRIL]`.
