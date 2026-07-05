# Proof Loop Buyer Validation

The latest plan review changes the next action: do not build another platform layer until real buyers react to the wedge. The smallest useful artifact is a five-question validation script that tests whether Proof Loop is a paid product, an OSS standard, or primarily a NodeRoom moat.

## Corrected Framing

Use this one-liner:

> Proof Loop proves your agent's work is real: it finished the task, used the right tools, and did not game the benchmark, so you can trust it before you ship.

Use "verification you run", not "certification", until independent adoption makes Proof Loop receipts meaningful outside the team that ran them.

## Buyer Profiles

- Solo founder or hackathon builder: validates the local npx path and the "help me ship without fake done" pain.
- Agentic finance, health, science, or operations workflow team: tests whether teams shipping real agent workflows need audit-grade receipts before release.
- Platform, infra, risk, or governance owner: tests whether anti-gaming proof maps to budget, data controls, and enterprise procurement.

## Five-Question Script

1. Think of an agent workflow your team would ship in the next 60 days. What proof would you need before letting customers or internal users rely on it?
2. If the agent passed a benchmark or eval, what would convince you it did not take a shortcut, leak answers, or game the score?
3. Would you run a local Proof Loop gate this week if it only wrote receipts on your machine and blocked fake done states? What would stop you?
4. Would hosted receipt dashboards be acceptable if source code stayed local? Which receipt fields would still be too sensitive to upload?
5. When would you pay for managed private Proof Loop: per-tenant indexes, BYO key or VPC deployment, audit-grade receipts, and team dashboards?

## Score The Five Conversations

Validate the wedge only if at least five real buyer conversations produce:

- Three buyers with active proof pain tied to a real workflow.
- Two buyers willing to run a local gate this week.
- One buyer who can name a budget owner or paid pilot path.
- No more than one hard reject.

If those thresholds fail, do not build the hosted dashboard. Reframe around local demo-shipping reliability or keep Proof Loop as an OSS standard that compounds NodeRoom.

## Data-Sensitivity Probe

Do not say hosted receipts are safe by default. Receipts can include task prompts, tool arguments, failure reasons, code paths, stack shape, model choices, and traces. The buyer must say which receipt fields are acceptable, which require redaction, and when BYO key, VPC, self-hosting, or tenant-owned storage becomes mandatory.

## Command

Generate the local worksheet with:

```bash
npm run proofloop:buyer-validation
```

The generated kit writes to `.proofloop/intake/buyer-validation/`, which is intentionally ignored with other local ProofLoop output.
