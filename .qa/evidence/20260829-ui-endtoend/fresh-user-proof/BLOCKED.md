# Fresh-user vertical proof rerun — BLOCKED 2026-08-29

The proofStaleness gate flagged `docs/eval/noderoom-fresh-user-vertical-proof.json`
(48.0 days old, 30-day window). The rerun was attempted today against the deployed
build (main db0b1654) and is blocked by a production auth outage, not by tooling:

1. `/?demo=<code>&name=<name>&confirmed=1` (the anonymous demo-entry path the e2e
   harness uses) renders the sample consent dialog; submitting it lands on
   "ACCOUNT REQUIRED — Sign in to start a sample room" (`post-submit.png`).
2. The gate offers only "Continue with GitHub"; no password form is reachable there.
3. GitHub sign-in fails instantly with `[CONVEX A(auth:signIn)] Server Error` —
   request IDs 79893016afcab855, aeab190b90dc5b4d, 93fd6cf1d43cfc04. No redirect to
   github.com ever happens. `authAccounts` on prod holds 50 accounts, all provider
   "password", zero "github".

Consequences, stated honestly:
- The gate stays RED on purpose. A fresh user currently cannot enter any live room,
  so the marketed fresh-user claim cannot be re-verified — rerunning is impossible
  until the auth outage is fixed (tracked as its own task).
- Product-path proxy proof that DID run today (labeled as proxy, not the official
  fresh-user receipt): the memory-mode demo room agent run on the live site — scripted
  intent run updating evidence counts / proof graph / version chips live
  (`../before-live/` + the session ledger), and the deployed build's chunk-graph
  content verification.

Next action lives with the auth-fix task: restore sign-in (or expose the password
path), live-verify a cold-visitor entry, rerun this proof, regenerate the JSON + MD.
