#!/usr/bin/env node
// Verify that every `@see https://learn.microsoft.com/...` URL referenced
// from `src/**/*.ts` resolves to a live page.
//
// Each per-call-site `*_SCOPES` constant in the feature clients carries
// a JSDoc `@see` link to the Microsoft Learn page that documents the
// permissions for that endpoint. Those links are part of the contract
// — when they 404, future contributors lose the ground-truth reference
// for what scopes the call site needs.
//
// Run as part of release prep, not on every PR (it makes ~12 outbound
// HTTPS requests). Invoked via `npm run docs:check`.
//
// Exits non-zero if any URL returns a non-2xx/3xx status, fails to
// resolve, or times out (per-URL 15s).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const URL_RE = /https:\/\/learn\.microsoft\.com\/[^\s")<>]+/g;
const TIMEOUT_MS = 15_000;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (st.isFile() && extname(full) === ".ts") yield full;
  }
}

function collectUrls() {
  const seen = new Map(); // url -> [files]
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf-8");
    for (const match of text.matchAll(URL_RE)) {
      // Strip trailing punctuation that's likely sentence-end, not URL.
      const url = match[0].replace(/[.,;]+$/, "");
      const list = seen.get(url) ?? [];
      list.push(file);
      seen.set(url, list);
    }
  }
  return seen;
}

async function check(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, TIMEOUT_MS);
  try {
    // Microsoft Learn rejects HEAD with 405 for some pages, so use GET
    // with a Range header to avoid downloading the full body.
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "pimdo-docs-check/1.0",
        Range: "bytes=0-2047",
        "Accept-Language": "en",
      },
    });
    return { ok: res.ok || res.status === 206, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const urls = collectUrls();
  if (urls.size === 0) {
    console.log("no @see learn.microsoft.com URLs found in src/");
    return;
  }

  console.log(`checking ${urls.size} unique Microsoft Learn URL(s)…`);
  const results = await Promise.all([...urls.keys()].map(async (u) => [u, await check(u)]));

  let failed = 0;
  for (const [url, result] of results) {
    if (result.ok) {
      console.log(`  ✓ ${String(result.status)} ${url}`);
    } else {
      failed++;
      const detail = result.error ? `(${result.error})` : "";
      console.error(`  ✗ ${String(result.status)} ${url} ${detail}`);
      const files = urls.get(url) ?? [];
      for (const f of files) console.error(`      from ${f.replace(ROOT, "")}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${String(failed)} of ${String(urls.size)} URL(s) failed`);
    process.exit(1);
  }
  console.log(`\nall ${String(urls.size)} URL(s) OK`);
}

await main();
