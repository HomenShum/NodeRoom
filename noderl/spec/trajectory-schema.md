# Trajectory schema

The trajectory is the unit NodeRL records, scores, and exports. It reconciles the **current**
production capture shape (what `nodetrace` already emits) with the **net-new** RL fields.

## Current shape (already emitted by `nodetrace`)

```ts
// step
interface CaptureStep {
  phase: string;            // "Observe" | "Act" | "Extract" | "Error"
  label: string;
  status: "ok" | "warn" | "risk";
  detail?: string;          // model reasoning lives here
  screenshotPng?: Uint8Array;
  box?: { x: number; y: number; w: number; h: number; page?: number }; // normalized 0..1
  log?: string;
  ms?: number;              // per-step duration
}

interface ActStep { kind: "click" | "type" | "scroll" | "press"; target?: ObserveTarget; value?: string }

// result (terminal observation)
interface CaptureResult {
  ok: boolean;
  url: string;
  title?: string;
  steps: CaptureStep[];
  data?: Record<string, unknown>; // extracted fields
  error?: string;                  // honest failure, never faked success
}
```

## Net-new RL fields (the export target)

```ts
interface NodeTrajectory {
  trajectoryId: string;
  environment: string;             // "noderoom" | "coding-repo" | "browser-ui" | ...
  agentHost: string;               // "codex" | "claude-code" | "windsurf" | "nodeagent" | ...
  goal: string;
  model?: string;
  initialState: { gitCommit?: string; url?: string; artifactRefs?: string[]; contextPackHash?: string };
  steps: NodeTraceStep[];
  outputs: { files: string[]; receipts: string[]; screenshots: string[]; videos: string[] };
  rewards?: NodeRewardSummary;     // see reward-design.md
  truncated?: boolean;
}

interface NodeTraceStep extends CaptureStep {
  episodeId: string;
  stepIndex: number;
  action: ActStep | { kind: "tool_call"; tool: string; args: unknown }
                  | { kind: "file_edit"; files: string[] }
                  | { kind: "test_run"; command: string };
  reward?: { process: number; reason: string };
  cost?: { tokensIn?: number; tokensOut?: number; latencyMs?: number; usd?: number };
}
```

## Export

`nodetrace` serializes `NodeTrajectory[]` to **JSONL**, one trajectory per line, for downstream
SFT / DPO-pair / RLVR pipelines. Screenshots are referenced by path, not inlined.

## Design notes

- **Honest status is load-bearing.** `ok:false` + `error` must never be coerced to success — the
  failure trajectory is the valuable RL signal.
- **Boxes are dual-mode** (screenshot page 0 + PDF pages) so evidence grounding is uniform.
- **Reasoner + substrate are injected**, so the recorder is host-agnostic and deterministically
  testable (mock both).
