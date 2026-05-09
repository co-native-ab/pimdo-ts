# Contributing to pimdo-ts

Thanks for considering a contribution! This document covers the basics.

## Prerequisites

- Node.js 22+
- npm (ships with Node.js)

## Getting Started

```bash
git clone https://github.com/co-native-ab/pimdo-ts.git
cd pimdo-ts
npm install
```

## Development Workflow

```bash
npm run lint         # ESLint (strict + stylistic)
npm run typecheck    # tsc --noEmit
npm run test         # Run tests via vitest
npm run format       # Format code with Prettier
npm run format:check # Check formatting without writing
npm run check        # format:check + icons:check + schemas:check + preview:check + lint + typecheck + test
npm run build        # Build with esbuild (dist/index.js)
npm run preview      # Regenerate the static preview site (.preview/index.html)
```

Always run `npm run check` before submitting a PR.

## Browser & tool previews

Run `npm run preview` and open `.preview/index.html` in a browser to
click through every browser-facing page (login, logout, requester,
approver, confirmer) and every MCP `*_list` tool's text output, in
both light and dark themes.

The output directory `.preview/` is gitignored — generated artefacts
are never committed. CI publishes the same site to GitHub Pages on
every push:

- `https://<owner>.github.io/<repo>/preview/main/` — latest `main`.
- `https://<owner>.github.io/<repo>/preview/pr/<id>/` — per-PR
  preview, regenerated on every push and removed on PR close. The PR
  itself gets a sticky comment with the URL.

The single source of truth lives in
[`scripts/preview/`](scripts/preview/). After changing a template or
formatter, run `npm run preview` locally to verify the new state. The
`npm run preview:check` gate (part of `npm run check` and CI) refuses
to pass when a surface is unregistered or a scenario fails to render —
see [ADR-0012](docs/adr/0012-preview-site-and-list-scenarios.md) and
the
[`preview-coverage`](.github/agents/preview-coverage.agent.md) agent.

## Branching & PRs

1. Create a feature branch from `main`
2. Make your changes in small, focused commits
3. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:
   - `feat:` — new feature
   - `fix:` — bug fix
   - `docs:` — documentation only
   - `refactor:` — code change that neither fixes a bug nor adds a feature
   - `test:` — adding or updating tests
   - `chore:` — maintenance (dependencies, CI, etc.)
4. Open a pull request against `main`
5. CI runs lint, typecheck, tests, and build automatically

## Code Style

- TypeScript strict mode with `noUncheckedIndexedAccess`, `noImplicitOverride`, and `noPropertyAccessFromIndexSignature`
- ES modules — all imports use `.js` extensions
- No `any` types — enforced by ESLint
- Early returns over nested conditionals
- Structured logging via `logger.debug/info/warn/error()`

See [AGENTS.md](AGENTS.md) for detailed architecture and design decisions.

## Testing

- **Unit tests** go in `test/` alongside the module they test (e.g., `test/config.test.ts`)
- **Graph layer tests** go in `test/graph/` using the mock server from `test/helpers.ts`
- **Integration tests** go in `test/integration/` using shared helpers from `test/integration/helpers.ts`
- Use `vitest` — no global test variables (`globals: false`)
- Mock HTTP via the `node:http`-based mock server, not mocking libraries

## Adding New Tools

1. Add Graph operations in `src/graph/`
2. Register the tool in `src/tools/`
3. Wire it up in `src/index.ts`
4. Add both graph-layer and integration tests
5. Run `npm run check`

See the [Adding New Tools](AGENTS.md#adding-new-tools) section in AGENTS.md for the full pattern.

## Config

pimdo-ts has no user-facing persisted configuration today. `src/config.ts`
exposes only `configDir()` (XDG-style resolution of where the MSAL auth
cache lives) and a no-op `migrateConfig()` stub kept as a forward-compatible
hook. When real persisted state is introduced, document the schema and
migration policy in a new ADR.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
