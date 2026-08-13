# Integrations — what this app talks to, and what happens when it cannot

**The important fact first: with no configuration at all, nothing below is
reached.** `npm run dev` with no `.env.local` runs the whole product in the
browser against an in-memory engine and a scripted model. Every integration here
is an *upgrade path*, and each one degrades to that tier rather than crashing.

Configuration lives in `.env.example` (6.7 KB, annotated). Nothing in this
repository requires a secret to run its tests.

## Convex — database, server runtime, and auth

| | |
|---|---|
| Enabled by | `VITE_CONVEX_URL` (and `VITE_CONVEX_SITE_URL` for streaming) |
| Client entry | `src/app/main.tsx` — `new ConvexReactClient(url)` |
| Server code | `convex/**` — 90 files, 80 tables in `convex/schema.ts` |
| If absent | `src/app/store.tsx` provides `EngineStoreProvider` instead; the room runs entirely in the tab |

Convex is not "a database we call". It is the server: `convex/*.ts` export
`query` / `mutation` / `action`, the client subscribes reactively, and there is
no separate API layer. Auth is `@convex-dev/auth` (`convex/auth.ts`,
`convex/auth.config.ts`, `convex/authEmail.ts`).

Six Convex **components** are mounted in `convex/convex.config.ts` — see
`docs/codebase/STACK.md` for what each one does. The one to know about is the
second `workflow` mount named `passiveWorkflow`, which exists so background jobs
get `maxParallelism = 1` and cannot starve foreground agent runs.

## Model providers

| | |
|---|---|
| Enabled by | `OPENROUTER_API_KEY`, or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_*` |
| Client | Vercel AI SDK v6 (`ai`) with `@ai-sdk/{anthropic,openai,google}` |
| Selection & pricing | `src/nodeagent/models/modelCatalog.ts`, `qualityFailover.ts`, `convexModel.ts` |
| If absent | `src/nodeagent/models/scripted.ts` — a deterministic scripted model. The demo room's agent genuinely runs the same loop and the same tools; only the model is replayed. |

Spend is bounded per run, not per deployment: `runAgent` takes `spendLimits` and
a `priceStep` function. Without `priceStep` the dollar half of the ceiling
silently receives `costUsd: 0` and does nothing — the comment in
`src/nodeagent/core/runtime.ts` says exactly this, because it was a real defect.

## Capture and document sources

| Integration | Where | Notes |
|---|---|---|
| Firecrawl (web capture) | `src/nodeagent/capture/substrate/firecrawl.ts`, called from `convex/capturesNode.ts` | Optional; an API key upgrade |
| Browserbase | `src/nodeagent/capture/substrate/browserbase.ts` | Imports `playwright-core`, which is **not** a declared dependency — see `CONCERNS.md` |
| SEC filings | `src/nodeagent/capture/secFacts.ts`, `convex/sec.ts` | Public endpoint |
| PDF | `react-pdf` + `unpdf` + `@llamaindex/liteparse`; box normalisation in `src/nodeagent/capture/pdfBox.ts` | Citation boxes are rendered by `src/ui/panels/PdfCitation.tsx` |
| Excel | `exceljs`, with `overrides` in `package.json` pinning `archiver` / `unzipper` / `fstream` to patched forks for known advisories | `fstream` is a vendored fork in `vendor/exceljs-security/` |

## Vendored packages

Seven dependencies resolve to `vendor/` rather than the registry: `@nodebook/*`
(notebook workspace), `@nodeslide/*` (slide engine), `@nodekit/gym-core`,
`@homenshum/nodegraph-live` (the live graph rail), and the `fstream` security
fork. They are `file:` specifiers, so a clean `npm install` works with no private
registry access.

Known rough edge: the vendored `nodegraph-live` tarball ships `.js` files that
reference `.js.map` files it does not include, so `npm run dev` prints
"Failed to load source map" warnings. Cosmetic, but it is the noisiest thing in
a first-run terminal.

## Hosting and delivery

| | |
|---|---|
| Primary | Vercel — `vercel.json`, including the production Content-Security-Policy |
| Also present | `netlify.toml` |
| Build gate | `scripts/verify-build-provenance.ts` runs inside `npm run build` and fails unless the emitted HTML carries the exact commit it was built from |
| CSP | Inline scripts are allowed by hash. `scripts/lib/cspIntegrity.ts` audits the deployed header against the HTML, and `tests/cspIntegrity.test.ts` fails a release whose inline route-guard changed but whose header hash did not |

## Developer-tool integrations (not the product)

`.mcp.json`, `.claude/`, `.cursor/`, `.windsurf/`, `.kilo/` configure coding
agents. `packages/walkthrough-review-cli/` is a local CLI/MCP tool. None of these
run in the application.

## The degradation table

The single most useful thing to know when something looks broken:

| Missing | Symptom | Still works |
|---|---|---|
| `VITE_CONVEX_URL` | No sign-in, no multi-user, no durable jobs | The whole room, the agent, the sheet, the trace — in memory |
| Model key | Agent replies are replayed, not generated | Every tool call, every CAS check, every trace entry — for real |
| Firecrawl / Browserbase key | Web capture tools fail | Everything else |
| Nothing at all | — | `npm run dev`, `npm test`, `npm run build` |
