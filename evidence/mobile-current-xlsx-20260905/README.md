# Mobile current-table XLSX: reviewed evidence

A reviewer opens the phone's local diligence table, edits a value and downloads the result. The old action claimed an export without creating a file. This repair produces a real workbook from those current rows, reports measured download dispatch, and requires an explicit retry after failure. Recorded status and claim references remain unverified sample metadata.

Start with the repository [HANDOFF](../../HANDOFF.md) for setup and limitations. The [independent verdict](reports/E6f_NODEROOM_MOBILE_EXPORT_FINAL_JUDGE.json) approves only this current-table export slice with inherited holds. It is not a full repository, native Excel, provider or production certificate.

## What was checked

| Evidence | Observed result |
|---|---|
| [Worker browser run](worker/browser-proof-final.log) | Eight scenarios pass; 19 actual mobile files saved and reopened; 40 saved PNGs across six widths |
| [Worker artifact recount](worker/final-browser-artifact-recount.json) | Exact saved image/HTML/workbook hashes; wider mobile route distinguished from natural desktop |
| [Unchanged memory workflow](worker/memory-regression-final.log) | Normal production build and 29 existing browser checks pass |
| [Focused workbook/dialog tests](worker/targeted-tests-final.log) | Eight existing plus new scenarios pass, including consumer text limits and post-serialization abort |
| [Independent browser replay](judge/browser-replay.log) | Three selected scenarios pass, including real files, duplicate/retry and close/reopen |
| [Independent literal and keyboard replay](judge/literal-keyboard/report.json) | Actual formula-like/leading-zero text, resource failure and native keyboard retry |
| [Independent raw workbook parsing](judge/independent-file-check.json) | 16 mobile files and one desktop file checked through ZIP/XML independently of ExcelJS |
| [Desktop historical parity](judge/desktop-parity.json) | Before, worker-after and independent worksheet models match, including five inherited blank Account cells |

The final worker and independent browser captures remain under `worker/browser-proof-final/artifacts` and `judge`. The [original zero-download run](baseline/mobile-download-before-01/report.json), [baseline floor failure](baseline/floor-baseline.log), and baseline advisory logs remain under `baseline`. Original 3px boundaries and failed intermediate probes remain under `worker/approved-before`, `worker/browser-proof-01` and `worker/filename-wrap-before`. Raw Markdown has a `.md.txt` suffix so it stays historical evidence, rather than current repository instructions.

## Replay from a fresh checkout

Use Node 22. Install the locked dependencies and Chromium before running browser tests:

```powershell
npm ci
npx playwright install chromium
npm run doctor
npm run test:product:memory
npx vitest run tests/artifactXlsxExport.test.ts tests/mobileSheetDialog.test.tsx tests/mobileSampleWorkbookExport.test.ts
```

The memory command performs a normal build and owns its preview process. Linux hosts missing system packages can use `npx playwright install --with-deps chromium` where that installation is permitted. `npm ci` alone does not install the browser. No environment file or provider key is required for this memory-mode proof.

For the named export proof, build and start a preview in one terminal:

```powershell
npm run build
npm run preview -- --host 127.0.0.1 --port 54431 --strictPort
```

Use a second terminal:

```powershell
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:54431'
$env:PLAYWRIGHT_PORT = '54431'
$env:PLAYWRIGHT_REUSE_SERVER = '1'
npx playwright test e2e/mobile-sample-workbook-export.spec.ts --workers=1 --retries=0
```

The test writes source bindings, HTML, PNGs, console observations and reopened workbooks to the configured Playwright output directory. Preserve that directory before another run. The retained operator wrappers have historical absolute paths; use the ordinary repository commands above for a new checkout, rather than executing those wrappers unchanged.

## Identity and retained limits

The implementation was independently reviewed at seven-file digest `5be5f9e25b7ba996c516943bb87b2fb918fa4bb36c40547e90285b42a03fd741`. Its earlier execution digest and the Chromium-only HANDOFF correction are retained separately. Publication updates HANDOFF links and this packet; the six runtime/test files remain identical to the reviewed bytes. The [raw binding map](raw-bindings.json) maps every original worker/judge path to its copied path and includes SHA256 plus Git blob identities. The [packet manifest](manifest.json) binds current packet files and excludes itself. The publication receipt and its separate review bind the staged Git tree without a circular self-hash.

All 739 worker payloads and 145 independent-judge payloads are retained exactly, together with their original manifests, final verdict, receipts and handoff addendum. Both generated archives retain exact payloads; Git custody and test-result metadata are evidence. Environment files, credentials, application databases and browser profile/auth/capability files are not included. Raw reports contain historical operator paths, not credentials or new runtime configuration.

The desktop null Account labels remain an explicit pre-existing data defect. This packet proves extraction parity, not desktop completeness. A separate forward repair must carry its own actual before/after workbook proof.

Mobile rows remain a separate synthetic sample and reset on close/reload. PowerPoint and historic workbook actions are unavailable. A receipt means browser dispatch started; saved proof files were separately captured. Rapid navigation and the controlled abort scenario do not claim serializer CPU cancellation or a long-running loading screenshot. Fallback fonts, doubled browser text, inherited modal scrolling, enlarged tabs and transient toast overlap limit visual conclusions. Full UI dimensions, native device/Excel, accessibility, performance, provider, human-use and production grades remain unassigned. The baseline COM timeout, NodeSlide dependency gate, nightly credential and audit/design-reference holds remain open.
