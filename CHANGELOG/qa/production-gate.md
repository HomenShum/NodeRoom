# Production gate changelog

## 2026-10-09 — Record the Undici audit improvement and remaining release failures

Developers and coding agents can keep the new README onboarding entry while using the repaired direct Undici dependency. The exact package-file port removes the observed high finding from the production audit, but current CI still stops before the complete application and fresh-user checks. This entry records those actual results so the next maintainer can address the remaining failures without reconstructing the session.

**Commit**: `f2a7596273196a4167fd3e703627ed4ccf1815cd` (tested dependency amendment). **Author**: Homen Shum.

The direct range changes from `^8.10.0` to `^8.11.2`; the lock changes its matching root range, direct version, published URL and integrity. All 1,077 other lock package records and the original 197-byte README onboarding insertion remain unchanged. This port reuses the existing exact package files and preserves the application, CI, immutable verifier, authentication and freshness policy.

| Observed evaluation | Actual result |
| --- | --- |
| Prior-head production audit at `1485807` | Both October 7 verify jobs reported 12 findings: 11 low and 1 high, including Undici. The audit exited 1; later production gates did not run. |
| Current PR production-only audit | `npm audit --omit=dev --audit-level=moderate` reported 11 low findings and no moderate/high finding or Undici report section. The unchanged `&&` chain proceeded to the security gate. This threshold pass is not a universal security certificate. |
| Current install summary, both CI events | Plain lifecycle-enabled `npm ci` succeeded: 944 packages added, 947 audited; 18 findings across all installed dependencies (11 low, 4 moderate, 3 high). This is separate from the production-only audit. Node 22.23.3 satisfies the retained Undici engine `>=22.19.0`. |
| Current PR checks after the audit | Security gate, design audit, UI-layer audit, UI contract, QA matrix and content fluency passed. The design audit retained 551 guidance warnings and disclosed its missing canonical token file. |
| Current PR first failure | `proofs:staleness` rejected `docs/eval/noderoom-fresh-user-vertical-proof.json`: 40.2 days old versus a 30-day window. The production step exited 1. |
| Current push first failure | `commit:check:range` rejected f2a759 because its message did not name the changed `package` area (`package-lock.json`, `package.json`). The production gate and its audit did not run in this event. |

The PR event checked synthetic merge `533144788e39a0eab2080f93b97c6beb8dae171e`, merging f2a759 into `6f1af0f7c3141c066088b11d1cbaae01e40e8ad0`. Its commit checker explicitly skipped changed-area checking for the merge commit; that successful step does not validate the rejected direct f2a759 message. The push event checked the real f2a759 commit with range `1485807bbbe43daac14a043f7a7ebe94ff9a2ba2..HEAD`.

Fresh-room proof, SLO, application and Convex typechecks, tests, product-memory tests, build, distribution security gate and Ladder evaluation remain **UNREACHED** in the current PR verify job. Authentic fresh-user/room evidence and the normal GitHub sign-in prerequisite remain unresolved. No proof timestamp, freshness window, checker or authorization requirement has been reset or waived.

Actual CI evidence:

- Before: [verify job 112701435847](https://github.com/HomenShum/NodeRoom/actions/runs/37593817075/job/112701435847) and [verify job 112701469536](https://github.com/HomenShum/NodeRoom/actions/runs/37593827593/job/112701469536).
- Current PR: [verify job 113648168873](https://github.com/HomenShum/NodeRoom/actions/runs/37877125745/job/113648168873).
- Current push: [verify job 113648159309](https://github.com/HomenShum/NodeRoom/actions/runs/37877122824/job/113648159309).

At this entry's preparation, ordinary publication and natural CI for this documentation amendment are **PENDING**. This record does not make earlier failed runs pass or certify merge readiness, production, all security, or completion of the repository portfolio.

## 2026-10-14 — Refresh the compatible sanitizer lock and retain release blockers

Developers and coding agents can install the patched DOMPurify sanitizer while retaining the reviewed Undici repair. This follow-up updates only DOMPurify's locked version, registry URL and integrity from 3.4.14 to 3.4.17; Mermaid's existing `^3.3.3` range already permits it. No application renderer code, dependency ranges or freshness policy changed.

**Base**: `c8789df42a425f6d101ecfac8e29a0cfa4b06eb9` (PR 256). **Status**: uncommitted local follow-up; publication and natural CI pending. **Author**: Codex.

The targeted command was `npm update dompurify --package-lock-only --ignore-scripts --no-audit --no-fund`. A record-by-record assertion found only the three intended DOMPurify fields changed; all 1,078 other lock records, including the root record, matched the base. The published 3.4.17 tarball URL and integrity matched the new lock. Direct Undici 8.11.2, nested Undici 6.28.1, Mermaid 11.16.1, KaTeX 0.16.47, manifests, README, tests and proof assets remained unchanged.

| Local observation | Before | After |
| --- | --- | --- |
| Locked DOMPurify | 3.4.14; patched-target assertion exited 1 | 3.4.17; assertion exited 0 |
| Production audit, unchanged moderate threshold | 11 low affected package nodes; DOMPurify present; exit 0 | 10 low affected package nodes; DOMPurify absent; exit 0 |
| Other audit findings | No moderate/high/critical or Undici finding | Identical remaining vulnerability records; low KaTeX chain remains |

Candidate checks ran on Node 22.22.2 and npm 10.9.7 in a fresh isolated checkout:

- `npm ci --ignore-scripts --no-audit --no-fund` passed, adding 938 packages. Installed/locked parity passed for DOMPurify, both Undici versions, Mermaid and KaTeX. Lifecycle scripts stayed disabled; install deprecation warnings were retained.
- `npm run floor` exited 1: application and Convex typechecks passed; 388 test files and 2,779 tests passed; one test failed. `tests/proofStaleness.test.ts` rejected `docs/eval/noderoom-fresh-user-vertical-proof.json` at 45.6 days old against the unchanged 30-day window. No receipt timestamp, window, test, claim or verifier was edited. This is not a passing floor.
- The canonical suite includes the existing source-fetch SSRF, pinned-DNS, redirect, byte/chunk-budget, timeout, repeated-wave and receipt scenarios, plus Streamdown plugin selection and the NodeBook workspace renderer integration. Transport is mocked in the network scenarios; the renderer integration uses jsdom. These checks do not prove real TLS behavior, pixel quality or universal sanitizer immunity. Vendored NodeGraph missing-source-map warnings were retained.
- `npm run build` passed, including the build-provenance verifier for `index.html` at checkout HEAD `c8789df`. The working tree included this uncommitted lock patch. Large-chunk warnings were retained; no bundle-threshold change was made.

The low KaTeX finding remains explicit: the patched 0.18.2 release is outside the four current incoming `^0.16` ranges, and the vendored NodeBook packages pin Mermaid 11.16.1. No forced override, direct dependency, renderer removal or wider migration was introduced. See the [KaTeX advisory](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7).

Private raw logs, exit records, registry binding, installed parity, graph comparison and hashes are retained under the campaign directory `_campaign-20261014/evidence/noderoom-sanitizer-followup/`; they are not published with this entry. The identical audit command on both sides was `npm audit --omit=dev --audit-level=moderate --json --ignore-scripts`.

Full `prod:gate`, fresh-user/room re-verification, product-memory/browser checks, distribution security gate, Ladder evaluation, deployment and merge readiness were not established by this local run. The existing stale-proof blocker remains unresolved. No browser automation, provider/model call, paid run, commit, push, merge or NodeRL registration retry was performed. A passing audit threshold and local build are not a production or zero-vulnerability certificate.
