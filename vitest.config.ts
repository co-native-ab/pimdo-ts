import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify("test"),
  },
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts"],
      reporter: ["text", "json", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 90,
        branches: 75,
        functions: 90,
        statements: 90,
      },
    },
    testTimeout: 10_000,
  },
});
