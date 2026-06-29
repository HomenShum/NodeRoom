# @noderl/nodetrace

Framework-free **trajectory / evidence recorder** for agent runs: browser + PDF actions,
per-step screenshots, normalized bounding boxes, extracted-field evidence, honest error status.

## Status

Core ~80% extracted from a production capture pipeline. Injectable reasoner + substrate, no DB
lock-in. RL export fields are the net-new work.

## Extraction manifest (from the NodeRoom repo)

| Source file | Role |
|---|---|
| `src/nodeagent/capture/types.ts` | core type contracts (`CaptureStep`, `CaptureResult`, `NormBox`, `ActStep`) |
| `src/nodeagent/capture/pipeline.ts` | `runCapture()` observe→act→extract loop |
| `src/nodeagent/capture/reasoning.ts` | `aiSdkReasoner()` (Vercel AI SDK, provider-agnostic) |
| `src/nodeagent/capture/guards.ts` | URL validation + repr clipping (SSRF posture) |
| `src/nodeagent/capture/pdfBox.ts` | pure box math (normalize, rotate, CropBox→NormBox) |
| `src/nodeagent/capture/substrate/{index,firecrawl,browserbase}.ts` | swappable capture substrates |
| `src/nodeagent/capture/secFacts.ts` | optional fallback data lane |

**Leave behind:** `convex/captures*.ts`, `src/ui/traceLens/*`, the AgentTool wrapper.

## Net-new (the RL export target)

- per-step `reward { process, reason }`
- per-step `cost { tokensIn, tokensOut, latencyMs, usd }`
- `episodeId` + `stepIndex`, `truncated` / `resumeFrom`
- **JSONL export** of `NodeTrajectory[]` (see `../../spec/trajectory-schema.md`)

## Strip before publish

- Default SEC user-agent email in `secFacts.ts` → placeholder.
- Document BYO keys; never bundle secrets (`../../SECURITY.md`).

## Sketch

```ts
import { runCapture, aiSdkReasoner, pickSubstrate } from "@noderl/nodetrace";

const trajectory = await runCapture({
  goal: "extract the revenue table",
  url: "https://example.com/10-k.pdf",
  reasoner: aiSdkReasoner({ model: yourModel }),  // injected
  substrate: pickSubstrate(),                       // firecrawl | browserbase
});
// trajectory.steps[]: action + screenshot + box + status (+ reward/cost once added)
```
