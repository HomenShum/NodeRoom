# Stack

Everything here is read off `package.json`, `convex/convex.config.ts`,
`vite.config.ts` and `tsconfig.json` in this commit. Versions are the declared
ranges, not the resolved lockfile pins.

## Language and build

| Thing | Choice | Where it is declared |
|---|---|---|
| Language | TypeScript 5.7, `strict: true`, `noUnusedLocals`, `noUnusedParameters` | `tsconfig.json` |
| Module resolution | `bundler`, with path aliases `@/*` → `src/*` (plus `@engine`, `@ui`, `@nodeagent`) | `tsconfig.json` |
| Bundler / dev server | Vite 6, single HTML entry (`index.html`) | `vite.config.ts` |
| UI runtime | React 19 (`react`, `react-dom`) | `package.json` |
| Styling | Tailwind CSS 4 via `@tailwindcss/vite`, plus hand-written CSS token layers (`src/ui/tokens.css`, `src/app/styles.css`) | `vite.config.ts`, `src/app/main.tsx` |
| Test runner | Vitest 4 (`npm test`) | `vitest.config.ts` |
| Browser tests | Playwright 1.60 — seven configs for different suites | `playwright*.config.ts` |

There is no `engines` field, so Node version is unpinned for local development.
The baseline measurement for this repo was taken on Node 22.

## Backend

Convex is both the database and the server runtime. There is no separate API
server; `convex/*.ts` files export queries, mutations and actions that the client
calls directly and subscribes to reactively.

Convex **components** mounted in `convex/convex.config.ts`:

| Component | What it does here |
|---|---|
| `@convex-dev/workflow` | Durable multi-step agent jobs. Mounted twice — the second mount, `passiveWorkflow`, exists so background/passive jobs get their own workpool with `maxParallelism = 1` and cannot starve foreground jobs. |
| `@convex-dev/workpool` (`agentWorkpool`) | Bounded parallelism for agent work. |
| `@convex-dev/persistent-text-streaming` | Streams model tokens to the asking tab over HTTP while persisting sentence-flushed chunks, so other tabs and post-refresh reloads still see the reply. |
| `@ikhrustalev/convex-debouncer` | Debounced writes. |
| `@convex-dev/prosemirror-sync` | Collaborative rich-text documents. |
| `@nodeslide/convex` | A vendored package's own Convex namespace, kept separate from the room's authoritative `artifacts` / `elements` / `proposals` tables. |

Auth is `@convex-dev/auth` with `@auth/core`. The schema in `convex/schema.ts`
declares 80 tables.

## Models

The agent talks to providers through the Vercel AI SDK (`ai` v6) with
`@ai-sdk/anthropic`, `@ai-sdk/openai` and `@ai-sdk/google` adapters. Model
selection, pricing and failover live in `src/nodeagent/models/`
(`modelCatalog.ts`, `qualityFailover.ts`, `convexModel.ts`). Tool argument
schemas are Zod 4.

**The app runs with no model key at all.** `src/nodeagent/models/scripted.ts`
supplies a deterministic scripted model for the in-memory demo tier, which is
why `npm run dev` needs no secrets.

## Document and data formats

| Format | Library |
|---|---|
| Excel workbooks | `exceljs` (with security overrides pinning `archiver`, `unzipper`, `fstream` — see `overrides` in `package.json`) |
| PDF | `react-pdf`, `unpdf`, `@llamaindex/liteparse` |
| Rich text | TipTap 3 (`@tiptap/*`) over ProseMirror |
| Markdown / code / math / diagrams in chat | `streamdown` plus `@streamdown/{code,math,mermaid,cjk}` |
| Graph views | `@xyflow/react`, `nodegraph`, `@homenshum/nodegraph-live` (vendored) |
| Python execution | `pyodide` |

## Vendored packages

Seven dependencies resolve to files in `vendor/`, not the npm registry
(`@nodebook/*`, `@nodeslide/*`, `@nodekit/gym-core`, `@homenshum/nodegraph-live`,
and the `fstream` fork used by the exceljs security override). They are declared
as `file:` specifiers in `package.json`, so `npm install` works from a clean
checkout with no private registry access.

## Hosting

Vercel (`vercel.json` — including the production Content-Security-Policy) with a
Netlify config also present (`netlify.toml`). `scripts/verify-build-provenance.ts`
runs as part of `npm run build` and fails the build unless the emitted HTML
carries the exact commit it was built from.
