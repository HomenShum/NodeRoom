# 45-second walkthrough script

The checked-in MP4 is a silent, five-seconds-per-slide proof walkthrough. This script
supports a voiced rerecording without changing the factual claims.

| Time | Slide | Narration |
|---:|---|---|
| 0:00–0:05 | Cover | I built the deployment room I would have wanted as a banker: a governed SMB lending workflow inside NodeRoom. |
| 0:05–0:10 | Operating problem | The hard part is reconstructing document state, dependencies, authority, and proof—not adding a chatbot. |
| 0:10–0:15 | Architecture | NodeRoom stays canonical. The lending pack supplies domain logic, and every durable change uses the same governed transaction. |
| 0:15–0:20 | Product proof | In the browser, two approvals moved the synthetic application from missing to requested to verified, then reopened both output hashes. |
| 0:20–0:25 | Authority | The agent proposes and validates. Human credit authority remains explicit at both material transitions. |
| 0:25–0:30 | Defect | The first production run exposed a frontend/backend deployment split that health checks missed. We fixed the binding and redeployed the exact clean commit. |
| 0:30–0:35 | Benchmark | Ten locked runs passed across manual, chat-only, graph, and memory-enhanced modes. This is a dimensional result, not a universal winner claim. |
| 0:35–0:40 | Platform learning | The deployment separates bank-specific configuration from reusable proposal, evidence, packet, and proof primitives. |
| 0:40–0:45 | Close | That is the FDE loop: live the workflow, build the system, close the production loop, and feed the learning back into the platform. |

End card: `Independent project · noderoom.live · source and proof available`.

