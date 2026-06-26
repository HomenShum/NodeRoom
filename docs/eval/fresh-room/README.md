# Fresh-Room Proof Receipts

Every live-browser benchmark or founder proof writes a receipt here:

```text
docs/eval/fresh-room/<case-id>/latest.json
```

The receipt is not a checklist. A pass requires:

- fresh room with no seeded memory
- real upload/import path
- real composer prompt
- deterministic readiness signal
- real export path
- official scorer result
- reopened artifact validation
- trace/video/screenshots
- cost, latency, token usage, mutation count

Harness-only passes cannot count toward product claims. A receipt with `pass: false` is evidence of a
blocked or incomplete proof, not a capability result.

The FR-020 finance/benchmark family is deliberately split:

- `FR-020` is the finance-domain runtime gate.
- `FR-020A` is selective BankerToolBench task plumbing.
- `FR-020B` is the full BankerToolBench suite target.

Run `npm run benchmark:fresh-room:proofs` to regenerate `proof-registry.json` and the FR-020
finance-domain receipt. The registry is the claim boundary: a pass in one lane never promotes the
other lanes.
