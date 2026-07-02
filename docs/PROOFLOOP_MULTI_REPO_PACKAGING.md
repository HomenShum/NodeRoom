# Proof Loop Multi-Repo Packaging

Proof Loop is developed in NodeRoom today, but it should ship as more than one
GitHub repository:

- `HomenShum/proofloop` - public local Proof Loop Core.
- `HomenShum/proofloop-hosted` - private hosted certification service lane.
- `HomenShum/noderoom` - reference app and integration proving ground.

The split must be generated from manifests, not manual copy/paste.

## Public Core

Target: `public-core`

Visibility: public

Purpose:

- CLI and local JSONL proof storage.
- App-agnostic `proofloop this-repo` intake.
- Workflow specs, local adapters, browser proof runner, cockpit, NodeTrace v2,
  NodeEval, memory, Trace Storybook, and focused tests.
- NodeRoom reference adapter and small fixture/demo data that is safe to ship.

Excluded:

- `.proofloop/` generated runs, goals, setup receipts, memory, and package
  outputs.
- Large or customer-like eval evidence under `docs/eval/fresh-room/`,
  `docs/eval/gemini-media-judges/`, and generated test outputs.
- Hosted service secrets, private judge fleet code, tenant storage, billing, and
  customer adapters.

Command:

```bash
npm run proofloop:package -- public-core --copy
```

Output:

```text
.proofloop/packages/public-core/manifest.json
.proofloop/packages/public-core/repo/
```

## Private Hosted Lane

Target: `private-hosted`

Visibility: private

Purpose:

- Private benchmark packs.
- Managed browser workers and judge fleet.
- Tenant-isolated storage, object storage, billing, RBAC, audit logs, and
  customer-owned storage adapters.
- Customer adapters and confidential certification reports.

Command:

```bash
npm run proofloop:package -- private-hosted --copy
```

Output:

```text
.proofloop/packages/private-hosted/manifest.json
.proofloop/packages/private-hosted/repo/
```

The private manifest deliberately lists missing hosted components until those
systems exist. A private package can be pushed, but it is not production-ready
until every listed component is implemented or explicitly blocked.

## GitHub Publish Flow

Generate packages first:

```bash
npm run proofloop:package -- public-core --copy
npm run proofloop:package -- private-hosted --copy
```

Create remotes only after repo names and ownership are confirmed:

```bash
gh repo create HomenShum/proofloop --public --source .proofloop/packages/public-core/repo --remote public-core
gh repo create HomenShum/proofloop-hosted --private --source .proofloop/packages/private-hosted/repo --remote private-hosted
```

Push:

```bash
git -C .proofloop/packages/public-core/repo push -u public-core main
git -C .proofloop/packages/private-hosted/repo push -u private-hosted main
```

If the GitHub repositories already exist, add remotes instead of creating them:

```bash
git -C .proofloop/packages/public-core/repo remote add public-core https://github.com/HomenShum/proofloop.git
git -C .proofloop/packages/private-hosted/repo remote add private-hosted https://github.com/HomenShum/proofloop-hosted.git
```

## Proof Rule

Public/private packaging is not a proof claim by itself.

Before marking either package ready:

```bash
npm run typecheck -- --pretty false
npm test -- --run tests/proofloopMultiRepoPackaging.test.ts tests/proofloopAppIntake.test.ts tests/proofloopPipeline.test.ts
npm run proofloop:package -- public-core --copy
npm run proofloop:package -- private-hosted --copy
```

For public Proof Loop Core, a real readiness claim still requires live browser
proof and receipts:

```bash
npm run proofloop -- this-repo
npm run proofloop -- run browser-live --cockpit --user-emulation strict
```
