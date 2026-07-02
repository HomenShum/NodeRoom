# Synthetic Underwriting Policy

This policy is demo-safe and exists only to evaluate the Proof Loop harness.

## Minimum Gate

- Revenue trend must be calculable from uploaded financials.
- Debt-service coverage ratio must be above 1.20x or marked needs_review.
- Customer concentration above 35 percent must be surfaced as a key risk.
- Any legal, insurance, environmental, or lien issue must be marked needs_review unless the source pack directly resolves it.
- The packet must not make a final credit decision. It may only recommend the next evaluation action.

## Packet Requirements

The generated underwriting packet must include:

- summary
- key risks
- mitigants
- financial or risk signals
- evidence links
- needs_review items
- next action recommendation

## Safety Boundary

All outputs are evaluation artifacts. They are not real underwriting advice, credit approval, insurance advice, or legal advice.
