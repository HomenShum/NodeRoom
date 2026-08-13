# Simplification report — Wave 3 (human-readiness)

Baseline commit: `5de0508`. Every "before" number was produced by running the
listed command on a fresh clone of that commit **before** any change; every
"after" number by running the same command on this branch. Nothing here is quoted
from an earlier session's report.

Environment for all runs: Windows 11, Node 22.22.2, `npm install --no-audit
--no-fund`, no `.env.local`.

## Measurements

| Measure | Before | After | Change | Evidence command |
|---|---:|---:|---:|---|
| Production files | 618 | 589 | **−29** | `git ls-files 'src/**/*.ts' 'src/**/*.tsx' 'convex/**/*.ts' \| grep -v '_generated' \| grep -viE '\.test\.\|\.spec\.\|/tests?/' \| wc -l` |
| Production source lines | 162,307 | 157,312 | **−4,995** | same file list piped to `xargs wc -l`, totals summed |
| Direct dependencies | 73 | 59 | **−14** | `node -e "console.log(Object.keys(require('./package.json').dependencies).length)"` |
| Direct devDependencies | 25 | 24 | **−1** | `node -e "console.log(Object.keys(require('./package.json').devDependencies).length)"` |
| Unused files (whole repo) | 228 | 201 | **−27** | `npx knip@5 --no-exit-code --reporter json` |
| Unused files under `src/` | 30 | 2 | **−28** | same run, filtered to `src/` |
| Unused exports | 427 | 420 | **−7** | same run |
| Unused exported types | 720 | 712 | **−8** | same run |
| Unused dependencies reported | 15 | 2 | **−13** | same run |
| Unused devDependencies reported | 3 | 2 | **−1** | same run |
| Duplicate blocks | 179 clones | 175 clones | **−4** | `npx jscpd@4 src convex --ignore "**/_generated/**"` |
| Duplicate lines | 1,726 | 1,658 | **−68** | same run |
| Duplicate percentage | 1.17 % | 1.17 % | 0 | same run |
| Circular dependencies (relative imports only — see note) | 7 | 7 | 0 | `npx dependency-cruiser@16 --validate src/landing/boot.ts convex/*.ts` |
| Vitest — failing files | 4 | 2 | −2 (see note) | `npm test -- --run` |
| Vitest — failing tests | 5 | 2 | −3 (see note) | same run |
| Vitest — passing tests | 2,712 | 2,714 | +2 | same run |
| Vitest — exit code | **1** | **1** | 0 | same run |
| Typecheck (app) | 0 | 0 | 0 | `npx tsc --noEmit` |
| Typecheck (convex) | 0 | 0 | 0 | `npx tsc --noEmit --project convex/tsconfig.json` |
| Build exit code | 0 | 0 | 0 | `npm run build` |
| Production HTML entries | 2 | 1 | **−1** | `ls dist/*.html` |
| Production bundle — total `dist/` | 48,828,357 B | 39,282,109 B | **−9,546,248 B (−19.6 %)** | `du -sb dist` |
| Production bundle — JS bytes | 28,441,403 B | 18,911,918 B | **−9,529,485 B (−33.5 %)** | `ls -l dist/assets/*.js \| awk '{s+=$5} END {print s}'` |
| Production bundle — JS chunks | 712 | 405 | **−307** | `ls dist/assets/*.js \| wc -l` |
| Browser workflow passes | not applicable — no Playwright run in this wave | | | the e2e configs need a running server and credentials for several suites; the product wave's browser evidence is in `promotion/evidence/` |
| Additions / deletions | — | — | **47 files, +1,158 / −5,661** | `git diff HEAD --shortstat` |

Split of that last row, because it matters which half is which:

| Scope | Files | + | − |
|---|---:|---:|---:|
| Source, tests, build config (`src`, `convex`, `tests`, `scripts`, `vite.config.ts`, `ai-elements-check.html`) | 36 | 13 | 5,046 |
| `package.json` | 1 | 0 | 15 |
| `package-lock.json` | 1 | 1 | 600 |
| Documentation added by this wave (`docs/START_HERE.md`, `docs/codebase/*`, `.dependency-cruiser.cjs`) | 9 | 1,144 | 0 |

### Notes on rows that could be read as better than they are

- **Vitest failing files 4 → 2 is not a fix.** Two of the four baseline failures
  (`tests/proofloopOrchestrator.test.ts`, `tests/nodebookWorkspaceProjection.test.tsx`)
  are load-sensitive timeouts that passed on the verification run and failed on
  the baseline run, on code this wave never touched. The two that remain
  (`proofStaleness`, `githubActionsRuntimePins`) failed before and after. **The
  suite still exits 1.** No test was weakened to change this.
- **Passing tests +2 with one test deleted.** `tests/aiElementsTerminal.test.tsx`
  (1 test) was deleted along with the component it covered, so the total moved
  2,717 → 2,716; the +2 passing is the three flakes passing minus that one
  deletion.
- **Duplicate percentage did not move.** Deleting 5,000 lines that contained
  4 clones out of 179 leaves the ratio where it was. Reported unchanged rather
  than dressed up.
- **Circular dependencies did not move.** See "left unresolved" below — six of
  the seven are type-only and erased at compile time; the seventh is deliberate
  mutual recursion.
- **The circular-dependency measurement is partial, in both columns.**
  dependency-cruiser does not resolve this repo's `@/*` path aliases under
  `moduleResolution: "bundler"`, so 7 is the count among *relative* imports. A
  cycle crossing an aliased import would not appear in either column. The
  limitation and how to reproduce it are in `docs/codebase/CONCERNS.md`; it is
  recorded rather than papered over because a clean-looking number from a tool
  that cannot see half the graph is worse than no number.
- **The bundle numbers are large because of a duplicated entry, not minification
  luck.** See the next section.

## What was deleted

### 1. The AI Elements catalogue page and everything only it reached (26 files)

`ai-elements-check.html` was a second Vite build entry rendering a gallery of
Vercel AI Elements components under the production CSP. The product's chat
(`src/ui/Chat.tsx`) imports **four** of those components; the gallery rendered
twenty, plus a second chat renderer (`src/ui/ai/AgentConversation.tsx`) that no
product surface used.

Because it was a second Rollup entry, it also caused the build to emit a **second
copy of every shared vendor chunk** — the before build contains two
`emacs-lisp-*.js`, two `main-*.js`, and so on. That is where 9.5 MB of the 9.5 MB
JS reduction comes from; the deleted source itself is ~5,000 lines.

Deleted:

- `ai-elements-check.html`
- `src/ui/ai/` — `aiElementsCheck.tsx`, `AiElementsShowcase.tsx`,
  `AiElementsGallery.tsx`, `AgentConversation.tsx`, `adapters.ts`
- `src/components/ai-elements/` — `agent`, `artifact`, `chain-of-thought`,
  `checkpoint`, `confirmation`, `context`, `conversation`, `inline-citation`,
  `model-selector`, `prompt-input` (1,463 lines on its own), `sources`, `task`,
  `terminal`
- `src/components/ui/` — `accordion`, `alert`, `carousel`, `input-group`,
  `input`, `progress`, `spinner`, `textarea`
- `tests/aiElementsTerminal.test.tsx` — the only caller of the deleted
  `terminal.tsx` was the gallery; a test with no production caller is not
  coverage

Edited to match:

- `vite.config.ts` — one Rollup input instead of two
- `scripts/verify-build-provenance.ts` — `BUILD_PROVENANCE_HTML_ENTRIES` is now
  `["index.html"]`
- `tests/buildProvenance.test.ts` — three cases that used
  `ai-elements-check.html` as "the secondary HTML entry" now assert the identical
  failures against `index.html`, with a comment recording the move. **No
  assertion was loosened**: same rejection, same message shape, same count of
  cases.
- `tests/cspIntegrity.test.ts` — the deleted page's fixture line removed; the
  `index.html` assertions are untouched
- `src/design/uiLayerPolicy.ts` — the Radix exception list named
  `chain-of-thought.tsx`, which no longer exists; the remaining single exception
  and its test are unchanged

### 2. Three orphan modules

- `src/lib/models/providers/gemini.ts` — no importer anywhere
- `src/nodeagent/capture/index.ts` — a barrel nobody used; every consumer imports
  `nodeagent/capture/<submodule>` directly
- `src/ui/motion/NodeTextReveal.tsx` — no importer anywhere

### 3. Fifteen direct dependencies

| Removed | Why it was safe |
|---|---|
| `@assistant-ui/react` | Zero imports in the repo. The chat is hand-rolled — see "left unresolved". |
| `embla-carousel-react`, `nanoid`, `tokenlens`, `use-stick-to-bottom` | Each was imported by exactly one deleted AI Elements file |
| `@dnd-kit/core`, `@dnd-kit/modifiers` | Zero imports |
| `@nodeslide/engine`, `@nodeslide/react-headless` | Zero imports; the other four `@nodeslide/*` packages are used and stay |
| `@sigma/node-border`, `graphology`, `graphology-layout-forceatlas2`, `sigma` | Never imported directly; all four are declared dependencies **of** `@homenshum/nodegraph-live` and still install transitively |
| `ansi-to-react` | Imported only by the deleted `terminal.tsx` |
| `@ai-sdk/gateway` (dev) | Zero imports |

Verified by grep for each specifier across `src`, `convex`, `tests`, `e2e`,
`scripts`, `packages`, `backend`, `remotion`, then by `tsc --noEmit` on both
projects and a full `npm run build`.

Deliberately **kept** despite being reported unused: `fstream` (it exists only to
satisfy the `overrides` block patching a known `unzipper`/`exceljs` advisory) and
`@homenshum/nodegraph-live` (a `file:` tarball knip cannot resolve; it is
imported by `src/ui/graph/LiveGraphRail.tsx`).

## What custom code was replaced by an existing capability

**None — and that is the honest answer.** This wave found the inverse situation
and resolved it by deletion rather than replacement: a vendored component library
sat in-repo, wired only to a demo page, while the product hand-rolls the same
surface. Replacing the hand-rolled surface with the library is a feature-level
rewrite of a 2,909-line file, which rule 3 of the gate forbids mixing into a
structural pass. It is recorded below instead of half-done.

## What was added

Four things, all of them documentation or measurement, none of them product code:

- `docs/START_HERE.md` — one user request followed through the code in runtime
  order, ten steps
- `docs/codebase/` — STACK, STRUCTURE, ARCHITECTURE, CONVENTIONS, INTEGRATIONS,
  TESTING, CONCERNS
- `.tours/` — three CodeTour files pointing at live source
- `.dependency-cruiser.cjs` — 25 lines, so that `npx dependency-cruiser
  --validate` names the product folders and follows `.ts`/`.tsx`. Without it the
  tool cruises four modules and reports a clean run that means nothing. This is
  the one config knob added, and it exists because the gate names that command as
  an evidence source.

## Findings left unresolved, with reasons

| # | Finding | Why it was left |
|---|---|---|
| 1 | `src/ui/Chat.tsx` (2,909 lines) hand-rolls the composer, part-stream rendering, tool-call lifecycle and scroll anchoring that `@assistant-ui/react` provides. The repo's own `.aui-practices.json` says so and grades the gaps P0. | This is a rewrite of the primary user surface, not a structural cleanup. Rule 3 forbids mixing feature work into this pass, and rule 2 requires characterization tests on an important path first. The unused dependency was removed so the repo no longer claims to use a library it does not. |
| 2 | One real runtime import cycle: `src/nodeagent/core/runtime.ts` ↔ `src/nodeagent/core/subagentDispatcher.ts`. | Deliberate mutual recursion (an agent dispatches subagents that run the same loop). The fix — inject `runAgent` into `executePlanAndDispatch` — touches the least-protected seam in the most important path. Fix shape recorded in `docs/codebase/CONCERNS.md`. |
| 3 | Six further cycles reported by dependency-cruiser are type-only in at least one direction and are erased at compile time. | Not defects. Listed in `CONCERNS.md` so the next person does not re-derive that. |
| 4 | `playwright-core` and `pdfjs-dist` are imported by `src/` files but not declared in `package.json`; they resolve only through hoisting. | Real risk, but adding a dependency is the opposite of this wave's direction and would need a version decision. Recorded in `CONCERNS.md`. |
| 5 | `npm test` exits 1. `tests/proofStaleness.test.ts` fails because a marketed proof artifact is 32 days old against a 30-day window. | The gate is working. The fix is to re-run the proof batch or withdraw the claim — both product decisions. **Widening the window would be falsifying evidence and was not done.** |
| 6 | `tests/githubActionsRuntimePins.test.ts` fails on a CI workflow pin. | Pre-existing at baseline; CI configuration, outside this wave's scope. |
| 7 | 199 files outside `src/` remain unreachable from any entry (74 in `scripts/`, 52 in `docs/`, 19 each in `noderl/` and `.qa/`). | One-off tooling and captured evidence, not product code. Deleting a benchmark script that a human runs by hand is a behaviour change with no test to catch it. |
| 8 | `README.md` is 2,537 lines / 193 KB and is the first file a stranger opens. | Editorial work on marketing and proof content, not structural reduction. `docs/START_HERE.md` was added as the real front door and the README now links to it. |
| 9 | Thirteen dated session transcripts (~600 KB) sit at the repository root. | Inert, and four are cited from `docs/`. Deleting build history is a judgement call for the owner, not a mechanical cleanup. |
| 10 | 266 npm scripts with no grouping. | Most are benchmark entry points. Renaming or namespacing them would break every doc and CI reference that names them. |
| 11 | Product defects D-2 … D-7 in `promotion/PROMOTION_LOG.md` (dead undo button, a cell edit that clears the cell, invisible review queue, axe-core critical). | Rule 3: feature fixes do not go in a structural pass. They are the next wave's queue. |

## How to reproduce every number here

```bash
git clone --depth 20 https://github.com/HomenShum/NodeRoom.git
cd NodeRoom
npm install --no-audit --no-fund

# counts
git ls-files 'src/**/*.ts' 'src/**/*.tsx' 'convex/**/*.ts' | grep -v '_generated' \
  | grep -viE '\.test\.|\.spec\.|/tests?/' | wc -l
node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies).length, Object.keys(p.devDependencies).length)"

# tools
npx knip@5 --no-exit-code --reporter json > knip.json
npx jscpd@4 src convex --ignore "**/_generated/**"
npx dependency-cruiser@16 --validate src/landing/boot.ts convex/*.ts

# the repo's own gates
npx tsc --noEmit && npx tsc --noEmit --project convex/tsconfig.json
npm test -- --run
npm run build && du -sb dist && ls dist/assets/*.js | wc -l

# every CodeTour location resolves (exit 1 if any does not)
node -e "const fs=require('fs');let bad=0;for(const f of fs.readdirSync('.tours')){const t=JSON.parse(fs.readFileSync('.tours/'+f,'utf8'));for(const s of t.steps){if(!fs.existsSync(s.file)){console.log('MISSING',s.file);bad++;continue;}const n=fs.readFileSync(s.file,'utf8').split(String.fromCharCode(10)).length;if(!s.line||s.line<1||s.line>n){console.log('BAD LINE',s.file,s.line);bad++;}}}console.log(bad?'FAIL '+bad:'OK');process.exit(bad?1:0)"
```

The tour validator above reports **OK** on this commit: 29 steps across three
tours, every file present and every line inside its file.

Substitute `git checkout 5de0508` for the "before" column.
