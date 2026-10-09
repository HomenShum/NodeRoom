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
