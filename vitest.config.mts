import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["tests/**/*.test.ts"], environment: "node", env: { REBUTTAL_DB_PATH: ":memory:", REBUTTAL_MOCK: "1" }, testTimeout: 20000 },
});
