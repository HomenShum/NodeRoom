# Finch Free-Router Availability Probe

Date: 2026-07-10

This is availability evidence, not an official Finch score. The probe used
`openrouter/free` against the same rebuilt Finch input used by the canonical
lane:

- content SHA-256:
  `3ec34639c8223c4ceb8f13307725539a9a04317fed00805f302dc86cfd7de2e2`;
- target sample: 40 tasks;
- attempted task rows: 7;
- provider attempts: 20;
- successful judgments: 0;
- estimated provider billing: `$0`;
- failure reserve consumed: `$2.00` of `$2.00`;
- official: `false`;
- promotion allowed: `false`.

## Observed Failure Classes

| Class | Task rows | Attempts | Meaning |
|---|---:|---:|---|
| Daily quota / rate limit | 2 | 5 | The account's free-model daily allowance had no remaining capacity. |
| Context limit | 3 | 9 | Finch's released 128k completion reserve exceeded routed endpoints' total context. |
| No image-capable endpoint | 2 | 6 | The current free pool had no endpoint that could accept the screenshot-bearing request. |

## Resulting Fix And Policy

The shadow route now caps completion at 8,192 tokens, which is sufficient for
the small structured judgment and avoids consuming a free endpoint's entire
context budget. That change applies only to non-promotable shadow runs; the
canonical Finch request remains unchanged.

NodeRoom remains free-first for product inference, exploration, repair, and
shadow evidence when free capacity is available. A dynamic free router cannot
replace Finch's pinned judge because model identity, multimodal availability,
quota, and routing can change per request. Certification therefore uses the
fixed direct-OpenAI judge under an explicit cap. No Azure resource or Azure
credential is required.

The next live shadow retest should run after the daily quota resets and must
record the resolved model for every successful response.
