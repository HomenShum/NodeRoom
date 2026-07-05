# ProofLoop npx Package Proof

Generated: 2026-07-05T05:50:22.759Z
Package: `proofloop@0.1.0`
Registry tarball: https://registry.npmjs.org/proofloop/-/proofloop-0.1.0.tgz
Summary: passed (15/15)

## Claims

| Claim | Status |
|---|---|
| `registryLive` | pass |
| `mitLicensed` | pass |
| `zeroDependencies` | pass |
| `cleanDoctorWorks` | pass |
| `cleanHelpWorks` | pass |
| `viteInitWorks` | pass |
| `gateNpmTestFallbackPasses` | pass |
| `hooksInstallAndStatusWork` | pass |
| `stopHookBlocksFailingGate` | pass |
| `forgeryGuardBlocksProofState` | pass |
| `tooluseEmptyLogFailsClosed` | pass |
| `tooluseDenyListFails` | pass |

## Steps

| Status | Step | Exit | Command |
|---|---|---:|---|
| pass | `npm-view` - Registry metadata is live | 0 | `npm view proofloop@0.1.0 name version license dependencies author dist.tarball --json` |
| pass | `clean-doctor` - Published npx doctor runs from a clean directory | 0 | `npx --yes proofloop@0.1.0 doctor` |
| pass | `clean-help` - Published npx help runs from a clean directory | 0 | `npx --yes proofloop@0.1.0 --help` |
| pass | `git-init` - Stranger repo is independent git state | 0 | `git init` |
| pass | `vite-init` - Published npx init detects Vite | 0 | `npx --yes proofloop@0.1.0 init` |
| pass | `gate-npm-test-fallback` - Published npx gate passes through npm-test fallback | 0 | `npx --yes proofloop@0.1.0 gate` |
| pass | `hooks-install` - Published npx installs Stop and tool-use hooks | 0 | `npx --yes proofloop@0.1.0 hooks install` |
| pass | `hooks-status` - Published npx reports installed hook status | 0 | `npx --yes proofloop@0.1.0 hooks status` |
| pass | `failing-gate` - Published npx gate records a failing npm-test fallback | 1 | `npx --yes proofloop@0.1.0 gate` |
| pass | `stop-hook-blocks-failing-gate` - Generated Stop hook blocks fake done while gate is failing | 0 | `C:\nvm4w\nodejs\node.exe <temp>/proofloop-npx-package-proof-1783230622761-f46c6b69e4e53\stranger-vite-repo\.proofloop\hooks\stop-gate.mjs` |
| pass | `forgery-guard-blocks-gate-state` - Generated PreToolUse guard blocks forged proof-state writes | 2 | `C:\nvm4w\nodejs\node.exe <temp>/proofloop-npx-package-proof-1783230622761-f46c6b69e4e53\stranger-vite-repo\.proofloop\hooks\pretooluse-guard.mjs` |
| pass | `tooluse-init` - Published npx writes expected-tool-use contract | 0 | `npx --yes proofloop@0.1.0 tooluse init` |
| pass | `tooluse-empty-log-fails-closed` - Tool-use verifier fails closed when the log is absent | 2 | `npx --yes proofloop@0.1.0 tooluse verify --contract tooluse-contract.json` |
| pass | `posttooluse-records-forbidden-call` - PostToolUse logger records a redacted forbidden call | 0 | `C:\nvm4w\nodejs\node.exe <temp>/proofloop-npx-package-proof-1783230622761-f46c6b69e4e53\stranger-vite-repo\.proofloop\hooks\posttooluse-log.mjs` |
| pass | `tooluse-deny-list-fails` - Tool-use verifier fails on forbidden tools and missing required tools | 1 | `npx --yes proofloop@0.1.0 tooluse verify --contract tooluse-contract.json` |

## Notes

- The package is executed through `npx` with a temp npm cache path, not from this repository.
- The stranger repo is generated under a temp directory and initialized as a separate git repository.
- Empty tool-use logs are unusable and fail closed with exit 2; deny-list violations fail with exit 1.
