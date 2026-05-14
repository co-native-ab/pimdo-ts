import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify("test"),
  },
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Use the worker-thread pool instead of the default `forks` pool.
    // Node 24 on Windows intermittently crashes a forked vitest worker
    // (`Worker exited unexpectedly`) when v8 coverage is enabled, even on
    // tests that pass cleanly on the same code in `forks` mode on every
    // other matrix entry (Linux/macOS Node 22+24, Windows Node 22). The
    // tests in this repo only spawn ephemeral in-process HTTP servers and
    // use mocked MSAL — no native add-ons or `process.chdir()` — so the
    // tighter isolation of `threads` is sufficient.
    pool: "threads",
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
