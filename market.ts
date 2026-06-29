name: CI

# Garde-fou : lint + tests + build à chaque push et pull request.
# Le code "argent" (indicateurs, stratégie, sizing) est testé avant tout déploiement.

on:
  push:
    branches: [main, master]
  pull_request:

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22

      # npm install (et non npm ci) car le lockfile peut différer après ajout
      # de dépendances. À figer avec `npm install` en local puis commit du lock.
      - name: Install
        run: npm install --no-audit --no-fund --legacy-peer-deps

      - name: Lint
        run: npm run lint --if-present

      - name: Tests unitaires
        run: npm run test:run

      - name: Build
        run: npm run build
