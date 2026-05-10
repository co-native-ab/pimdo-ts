#!/usr/bin/env node

// Builds and packs an MCPB bundle from a minimal staging directory.
// Only the files required by the manifest are included — no source, tests, or tooling.
//
// Usage: node scripts/bundle-mcpb.mjs [--no-build] [output]
//   --no-build  Skip the build step (assumes dist/ is already up to date)
//   output      Path for the .mcpb file (default: pimdo.mcpb)

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const stageDir = join(root, ".mcpb-stage");

const args = process.argv.slice(2);
const noBuild = args.includes("--no-build");
const output = args.find((a) => a !== "--no-build") ?? "pimdo.mcpb";

// Files to include in the bundle (paths relative to repo root)
const include = ["manifest.json", "dist/index.js", "assets/symbol.png", "README.md", "LICENSE"];

// ---------------------------------------------------------------------------
// 1. Build
// ---------------------------------------------------------------------------

if (!noBuild) {
  console.log("Building…");
  execSync("npm run build", { cwd: root, stdio: "inherit" });
}

// ---------------------------------------------------------------------------
// 2. Stage
// ---------------------------------------------------------------------------

rmSync(stageDir, { recursive: true, force: true });

for (const file of include) {
  const src = join(root, file);
  const dest = join(stageDir, file);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
}

console.log(`Staged ${include.length} files in .mcpb-stage/`);

// ---------------------------------------------------------------------------
// 3. Pack
// ---------------------------------------------------------------------------

try {
  // Resolve mcpb's CLI through Node's module resolver and invoke it with
  // the current Node interpreter. This avoids shelling out to the bin
  // shim (`node_modules/.bin/mcpb` vs `mcpb.cmd` on Windows) and keeps
  // the script cross-platform. We resolve the package's main entry
  // (which is in its `exports` map) and walk up to the package root,
  // because `package.json` itself is not exported.
  const require = createRequire(import.meta.url);
  const mcpbMain = require.resolve("@anthropic-ai/mcpb");
  const mcpbRoot = join(dirname(mcpbMain), "..");
  const mcpbCli = join(mcpbRoot, "dist", "cli", "cli.js");
  execFileSync(process.execPath, [mcpbCli, "pack", stageDir, join(root, output)], {
    cwd: root,
    stdio: "inherit",
  });
  console.log(`\nBundle written to ${output}`);
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
