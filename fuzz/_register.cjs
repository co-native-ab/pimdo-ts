// Register tsx's CommonJS hook so jazzer can require TypeScript source
// files directly, without a separate compile step. Each fuzz target
// requires this module first.
require("tsx/cjs");
