import { defineConfig } from "vitest/config";

// Tests unitaires du moteur de trading (environnement Node, pas de DOM).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
