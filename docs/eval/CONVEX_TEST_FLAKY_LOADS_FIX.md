# convex-test flaky load failures — diagnosis + ready-to-apply fix

> Handoff note (2026-06-29). Root cause is solid; the fix is **reasoned + confirmed non-breaking**
> but **not reproduced in isolation** (the failure is flaky). Apply the config fix first, then
> verify with repeated full-suite runs (protocol below). Owner: whoever owns the shared vitest config.

## Symptom

In the full `vitest run` (CI `verify`), a convex-test file intermittently fails at the **file level**
(0 tests run) with:

```
Error: Cannot find module '<repo>\node_modules\vite-node\node_modules\@convex-dev\workflow\dist\component\schema.js'
       imported from <repo>\node_modules\vite-node\dist\client.mjs
```

It is **flaky / run-order-dependent**: a *different* convex-test file fails each run (observed:
`agentJobsRuntime`, `assistiveInboxP3`, `nativeNotebookProsemirror`, `notebookProcessingTarget`,
and once `chatReasoningFrames`), and the same file passes when it loads `@convex-dev/*` after
another test already did. Run alone, these files usually pass — so it is not a per-file bug.

## Root cause

`@convex-dev/workflow` (and `@convex-dev/workpool`) ship a **restrictive `exports` map** — it
exposes `.`, `./test`, `./convex.config`, `./_generated/component.js`, `./package.json`, but **NOT**
`./dist/component/schema.js`. Node's exports policy therefore *blocks* a clean package import of the
component schema, so the tests reach for the deep **relative** path instead:

```ts
import workflowSchema from "../node_modules/@convex-dev/workflow/dist/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/dist/component/schema.js";
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/dist/component/**/*.js");
```

When vite **externalizes** that module (its default for `node_modules` deps) and re-imports it at
runtime, vite-node resolves the `../node_modules/...` specifier relative to **its own** dir
(`node_modules/vite-node/dist/`) instead of the importing test file — producing the
`node_modules/vite-node/node_modules/@convex-dev/...` path that does not exist. Whether vite
externalizes vs. already has the module transformed/cached depends on load order → flaky.

## Affected files (4)

- `tests/agentJobsRuntime.test.ts`
- `tests/assistiveInboxP3.test.ts`
- `tests/nativeNotebookProsemirror.test.ts`
- `tests/notebookProcessingTarget.test.ts`

## Recommended fix — config only (lowest churn)

Inline the `@convex-dev` deps so vite **transforms** them (resolving the relative import against the
test file at transform time) instead of externalizing + runtime-rebasing. In `vitest.config.ts`:

```ts
  test: {
    environment: "node",
    include: [/* unchanged */],
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
    setupFiles: ["tests/setup/dom.ts"],
    server: {
      deps: {
        inline: [/@convex-dev\//],   // <-- add: transform, don't externalize, these deep imports
      },
    },
  },
```

**Probe result:** with this config, `agentJobsRuntime.test.ts` loads and passes (28/28) — i.e. the
inline does **not** break an affected file. It was **not** possible to make the flaky load failure
manifest in isolation, so treat this as the first thing to try and verify in the parallel suite.

## Alternative fix (if inline is insufficient)

Stop using the deep relative path. Add absolute aliases in `vitest.config.ts` `resolve.alias` and
switch the 4 files' static imports + globs to them:

```ts
resolve: { alias: {
  "convex-workflow-component": fileURLToPath(new URL("./node_modules/@convex-dev/workflow/dist/component", import.meta.url)),
  "convex-workpool-component": fileURLToPath(new URL("./node_modules/@convex-dev/workpool/dist/component", import.meta.url)),
}}
// then: import workflowSchema from "convex-workflow-component/schema.js";
//       import.meta.glob("convex-workflow-component/**/*.js")  (verify glob honors the alias)
```

Aliases resolve to an absolute base, eliminating the relative-rebase race. Costs touching 4 files.

## Verification protocol (the failure is flaky — repeated runs required)

```bash
# BEFORE (baseline the flake rate):
for i in 1 2 3 4 5; do npm test 2>&1 | grep -E "Test Files .*failed"; done
# Note which files fail and how often.

# AFTER applying the fix, same 5 runs:
for i in 1 2 3 4 5; do npm test 2>&1 | grep -E "Test Files .*failed"; done
# Expect: the @convex-dev "Cannot find module" file-load failures gone across all 5.
```

## Risk

- Inlining `@convex-dev/*` adds transform cost (slightly slower suite) and *could* surface a
  transform error in that package's code — the full-suite run in the protocol will catch it.
- Unrelated preexisting failures to keep separate: `contentFluency` fails only via its subprocess
  spawn (`node --import tsx/loader`) though `scripts/content-fluency-check.ts` passes standalone —
  a different, environmental issue, not this one.
