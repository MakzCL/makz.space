import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/perf/**/*.perf.ts"], environment: "node", testTimeout: 1800000, pool: "forks" } });
