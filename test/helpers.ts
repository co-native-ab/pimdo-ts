// Test helpers shared across the pimdo-ts vitest suites.
//
// Phase 1 has no PIM Graph fakes yet — the graphdo-ts mock-graph was
// dropped — so this module only provides primitives that don't depend
// on a fake server: an AbortSignal-with-deadline factory and a
// CSRF-token extractor for the loopback browser tests.

/**
 * Returns a per-test AbortSignal that times out after 10 seconds.
 * Analogous to a CancellationToken in xUnit's test context — provides a
 * deadline for async operations in tests.
 */
export function testSignal(): AbortSignal {
  return AbortSignal.timeout(10_000);
}

/**
 * Fetch the loopback page at `pageUrl` and extract the CSRF token from
 * the `<meta name="csrf-token">` tag. Throws if the meta tag is missing.
 *
 * Used by tests that POST to the login / logout (and, in later phases,
 * requester / approver / confirmer) loopback servers — they require a
 * valid CSRF token + JSON Content-Type after the §5.4 hardening.
 */
export async function fetchCsrfToken(pageUrl: string): Promise<string> {
  const res = await fetch(pageUrl);
  const html = await res.text();
  const match = /<meta name="csrf-token" content="([^"]+)">/.exec(html);
  if (!match?.[1]) {
    throw new Error(`No csrf-token meta tag found at ${pageUrl}`);
  }
  return match[1];
}
