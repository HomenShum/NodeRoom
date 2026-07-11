# NodeRoom Production Migration Runbook

Captured: 2026-07-10 (America/Los_Angeles)

Status: rehearsed on isolated Convex preview; production execution blocked on owner decisions and a supervised maintenance window

## No-Go Conditions

Do not start the production migration when any of these are unresolved:

- no approved disposition or account-claim path for legacy anonymous rooms;
- no announced write freeze of at least three hours;
- no fresh, storage-inclusive source and destination snapshots with hashes and full archive tests;
- no operator available to monitor the import and perform rollback;
- release branch checks, authenticated preview proof, or independent taste approval are not green;
- production GitHub OAuth callback or Vercel build coordinates do not match the target Convex deployment.

## Rehearsal Baseline

- Source: `zealous-goshawk-766`.
- Destination rehearsal: `agreeable-civet-283` (one-day preview).
- Snapshot: `5,078,797,442` bytes, SHA-256 `CE13AF578BD4A36D660C26BCBEF58C4D7580EE6FE8414F492522169F106A2FBD`.
- Imported: `8,312,277` documents and `13,105` stored files.
- Duration: `1h59m45s`.
- Post-import: `1,998` rooms, `13,105` stored files, matching function-spec hash, and resolved sample references.
- Rehearsal token revoked; temporary credential file deleted.

The rehearsal proves schema and storage compatibility. It does not prove zero-downtime cutover or legacy-account ownership migration.

## Phase 1: Owner Decisions

Record explicit decisions for:

1. Legacy room policy: claim, temporary compatibility, or retirement.
2. Maximum accepted write-freeze duration and user-facing maintenance copy.
3. Roll-forward versus rollback authority.
4. Independent taste-gate approval.

Do not infer these decisions from technical success.

## Phase 2: Freeze And Snapshot

1. Put `noderoom.live` into a maintenance/read-only state before the source snapshot timestamp.
2. Confirm no new room, member, message, artifact, upload, proposal, or trace writes are accepted.
3. Export `zealous-goshawk-766` with file storage to a new timestamped ZIP.
4. Export `aromatic-bass-102` with file storage to a new timestamped ZIP.
5. Run `7z t` and SHA-256 over both archives.
6. Record byte size, entry count, storage entry count, hash, start time, and completion time.

Abort if either archive is missing, unreadable, or unverified.

## Phase 3: Backend And Import

1. Keep production identity enforcement disabled.
2. Deploy the release Convex functions/schema to `aromatic-bass-102` and verify the function spec before data import.
3. Import the fresh source snapshot with `--replace-all --yes` during the write freeze.
4. Monitor until Convex returns a terminal success. The rehearsal required nearly two hours.
5. Do not switch frontend coordinates during an active or ambiguous import.

Abort and restore the destination snapshot if schema validation fails, import terminates unsuccessfully, or the terminal state cannot be established.

## Phase 4: Data Verification

Before frontend promotion, verify:

- exact room and storage counts from the import receipt;
- representative counts for artifacts, elements, messages, traces, jobs, proposals, and uploads;
- artifact-to-room, artifact-to-element, message-to-room, upload-to-storage, and proposal-to-artifact references;
- storage URLs resolve for representative uploaded files;
- function-spec hash matches the authenticated release preview;
- no post-freeze source writes need replay.

Keep maintenance mode active on any mismatch.

## Phase 5: Auth And Frontend

1. Set production `SITE_URL=https://noderoom.live` on the target Convex deployment.
2. Verify GitHub OAuth client ID/secret and JWT signing keys without printing them.
3. Set Vercel production build values for the target Convex cloud/site URLs, auth required, and GitHub provider.
4. Deploy the matching frontend revision.
5. Test GitHub sign-in and the approved legacy-room claim/disposition path.
6. Enable strict Convex identity only after both paths pass.

## Phase 6: Production Proof

Run at 390x844 with a fresh browser profile:

- first account and empty-room creation;
- invited-member join or approved legacy-room claim;
- public message, reload persistence, sign-out, and fail-closed rejoin;
- sample consent and governed deck Plan to Slides to scoped request;
- proposal accept and reject;
- evidence and trace inspection;
- PPTX/XLSX export receipt and downloaded-file integrity;
- mobile homepage CTA, keyboard focus, touch targets, overflow, and console/network health.

Production remains blocked until every journey passes and the independent taste gate approves promotion.

## Rollback Triggers

Rollback immediately when:

- import or count parity fails;
- representative references or stored files do not resolve;
- GitHub sign-in fails or users cannot claim/join their intended rooms;
- strict identity admits token-only fallback or locks out approved users;
- error rates, room creation latency, or reload recovery breach the launch bar.

Rollback order:

1. Restore the verified `aromatic-bass-102` pre-cutover snapshot.
2. Restore the prior Vercel production deployment and coordinates.
3. Keep strict identity disabled.
4. Reopen the old source only after verifying its write state.
5. Record exact timestamps, hashes, deployment IDs, and the failed gate.
