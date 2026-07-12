# Browser Verification — the reliable recipe

**Why this doc:** live-preview DOM verification is the single most repeated loop in this
repo's agent history (~1,300 browser tool calls). This page is the one place that says
how to do it without hitting the known traps. Visual claims require rendered proof
(screenshot or DOM assertion against the built preview) — build success alone proves
nothing.

## The recipe (build → preview, never cold dev)

Do NOT spin up a fresh `vite` dev instance for verification — it cold-start-hangs
(recursive `.tmp` clones churn the file watcher, and a second Vite fights the
`node_modules/.vite` dep-cache lock when a dev server is already running).

```bash
npx vite build                # skip `tsc &&` — that is what `npm run floor` is for
npx vite preview --port 5260 --strictPort --host 127.0.0.1
```

- `vite preview` serves `dist/` statically: no file watcher, no dep optimization,
  immune to `.tmp` churn, loads instantly.
- Always `--host 127.0.0.1` — Vite otherwise binds IPv6 `::1` and you get
  `ERR_CONNECTION_REFUSED`.
- `import.meta.glob` resolves at build time: new fixture JSONs are baked in only
  after a rebuild.

## Playwright against the built preview

`npx playwright test` with the default webServer HANGS on this machine (it starts
`vite dev`, which cold-start-hangs — verified 2026-06-28). Point it at the preview
you started instead:

```bash
PLAYWRIGHT_PORT=5260 PLAYWRIGHT_REUSE_SERVER=1 \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5260 npx playwright test
```

- Default e2e runs in MEMORY mode (`/?mode=memory`) — no Convex backend or keys.
  `*.backend.spec.ts` and `three-user-collab.spec.ts` self-skip unless
  `E2E_CONVEX_URL` is set; those skips are expected.
- Prefer `getByTestId` over text/role matching — product copy changes must not break
  the harness.
- Selector ground truth before browser work: `npm run proofloop -- ui contract --dense`.

## Gotchas that have burned us

- **Hidden tabs pause the app**: a preview tab with `document.hidden === true` pauses
  observers and screenshot-dependent behavior. Verify via JS eval + `getComputedStyle`,
  or front the tab before capturing.
- **Occlusion is not padding**: on mobile, `padding-bottom` under the dock is a no-op;
  verify occlusion with Playwright bounding-rect comparisons, not by eyeballing CSS.
- **Demo-room fixtures**: QA trace bundles render only in NON-BankerToolBench rooms —
  enter via `[data-testid="start-demo-room"]`, dismiss the tour (`tour-skip`), then
  `[data-testid="trace-tab"]`.
- **design-baseline snapshots**: `e2e/design-baseline.spec.ts` is an approved-baseline
  visual regression (maxDiffPixelRatio 0.012). After an INTENTIONAL redesign it will
  fail — regenerate with `--update-snapshots` and commit the PNGs.
- **state-captures churn**: `state-captures.spec.ts` overwrites
  `docs/qa/state-captures/*.png` + workflow GIFs nondeterministically on full runs;
  `git checkout --` the ones you didn't intend to change.

## Live production verification

Local preview proof ≠ shipped. For prod claims use
`npm run ship:prod -- --signal "<string your change adds>"` — it asserts the signal
in the RAW prod HTML (what crawlers/agents see), which catches disconnected deploy
webhooks, SSR Suspense shells, and stale CDN HTML. See CLAUDE.md "Deploys".
