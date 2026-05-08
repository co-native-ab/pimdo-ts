// Persistent config for pimdo-ts.
//
// pimdo has no user-facing persisted configuration in v1. All "config"
// today is effectively the auth-cache / account files written by
// `src/auth.ts`, which are not managed through this module.
//
// This module therefore exists for two narrow reasons:
//
//   1. {@link configDir} — XDG-style resolution of the directory where
//      the auth cache lives, with `PIMDO_CONFIG_DIR` override.
//   2. A no-op {@link migrateConfig} stub returning
//      {@link ConfigMigrationStatus.NoChange}, so `src/index.ts` and
//      future code keep a forward-compatible call site for adding real
//      schema migrations later without churn.
//
// When pimdo grows real persisted state, this module is the place to
// add a `ConfigFileSchemaV1` and a real migration pipeline.

import * as os from "node:os";
import * as path from "node:path";

import { logger } from "./logger.js";

/**
 * Outcome of {@link migrateConfig}.
 *
 *  - `NoChange` — nothing on disk needed migrating.
 *
 * This enum will grow when pimdo introduces real versioned persisted state.
 */
export enum ConfigMigrationStatus {
  NoChange = "no_change",
}

/**
 * Returns the configuration directory path.
 * Uses an override if provided, otherwise falls back to OS-appropriate defaults.
 */
export function configDir(overrideDir?: string): string {
  if (overrideDir !== undefined) {
    const resolved = path.resolve(overrideDir);
    logger.debug("config directory (override)", { path: resolved });
    return resolved;
  }

  const platform = os.platform();
  const home = os.homedir();
  let dir: string;

  if (platform === "win32") {
    const appData = process.env["APPDATA"];
    const base = appData ?? path.join(home, "AppData", "Roaming");
    dir = path.join(base, "pimdo-ts");
  } else if (platform === "darwin") {
    dir = path.join(home, "Library", "Application Support", "pimdo-ts");
  } else {
    const xdg = process.env["XDG_CONFIG_HOME"];
    const base = xdg ?? path.join(home, ".config");
    dir = path.join(base, "pimdo-ts");
  }

  logger.debug("config directory", { path: dir });
  return dir;
}

/**
 * No-op migration stub. pimdo has no on-disk schema to migrate today;
 * this exists so the startup hook in `src/index.ts` can stay
 * forward-compatible. When a real config file is introduced, replace
 * this with a real read-parse-migrate-rewrite path.
 */
export function migrateConfig(
  _configDir: string,
  _signal: AbortSignal,
): Promise<ConfigMigrationStatus> {
  return Promise.resolve(ConfigMigrationStatus.NoChange);
}
