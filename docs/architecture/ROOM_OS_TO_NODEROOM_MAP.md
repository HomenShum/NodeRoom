# Room OS To NodeRoom Map

Status: first-pass compatibility map from the local Room OS voice-agent repo to
NodeRoom. This map is an implementation guide, not an approval to copy runtime
ownership into NodeRoom.

Source repo inspected locally: `D:/VSCode Projects/local-collab-mvp(3)/room-os`.

The merge rule is simple: reuse voice I/O and session behavior, adapt guard and
classifier ideas, and discard anything that would make Room OS the durable room
or agent-work owner.

| Room OS module/file | Purpose | Reuse as-is / adapt / discard | NodeRoom target location | Risks | Tests required |
| --- | --- | --- | --- | --- | --- |
| `src/voice/voiceAgent.ts` | Produces a scheduled voice-agent utterance from authoritative room state, with deterministic fallback and acknowledgement cleanup. | Adapt | `src/voice/gateway.ts` and `src/voice/narration.ts`. Keep only the output-shaping and fallback ideas. | It assumes a count-task room reducer and local agent IDs; do not import as a NodeAgent executor. | Unit test that TTS/voice decisions cannot call durable mutation APIs. |
| `src/voice/runVoiceMvp.ts` | CLI demo loop for local voice agents counting in turn. | Discard as runtime; reuse as smoke-test inspiration. | Possible fixture under `tests/` after voice domain types exist. | Demo target is counting, not NodeRoom work. It can mislead implementation toward a parallel loop. | Deterministic voice-session smoke for turn progression only. |
| `src/voice/localAudioAdapters.md` | Documents STT/TTS/VAD adapter boundaries and preserves `onTranscript -> applyUtterance` shape. | Reuse concept | `docs/architecture/VOICE_AGENT_MERGE_ADR.md` and future provider adapter docs. | The function names point at Room OS reducer state, not NodeRoom RoomCommand. | Doc-contract test verifies the bridge is `VoiceTurn -> RoomCommand`, not reducer mutation. |
| `src/core/types.ts` | Defines actor IDs, speech acts, room task, artifacts, and room state. | Adapt selectively | `src/voice/types.ts`: `VoiceTurn`, `VoiceSessionState`, `RoomCommand`. | Copying `RoomState` would create a second durable state model beside Convex. | Type-level tests for risk level, confirmation requirement, and source tracking. |
| `src/core/roomReducer.ts` | Deterministic reducer for count progress, loop guard, and speaker scheduling. | Adapt only session logic | `src/voice/stateMachines.ts`; no artifact/job state. | The reducer mutates task state directly; NodeRoom already owns durable jobs and artifacts. | Test that voice reducer has no artifact/job/proposal fields. |
| `src/core/speechActClassifier.ts` | Rule-based speech-act fallback: backchannel, task action, handoff, instruction, correction, summary. | Adapt | `src/voice/commandClassifier.ts` fallback before model intent classification. | Deterministic rules can be too coarse for artifact writes; they must downgrade to draft/clarify when uncertain. | Cases for read, draft, write, destructive, and ambiguous utterances. |
| `src/core/guards.ts` | Enforces room policy for acknowledgement suppression and required next speech act. | Adapt | `src/voice/commandClassifier.ts` and `src/voice/gateway.ts` confirmation guard. | Room OS guard blocks speech acts; NodeRoom guard must protect durable writes and privacy. | Governance tests for low-confidence and risky commands. |
| `src/live/pipeline.ts` | Server-side STT, LLM intent, TTS, timeout, size-cap, and model-router code. | Adapt | `src/voice/adapters/*` behind VoiceGateway. NodeAgent model routing remains in NodeRoom. | Provider keys, model names, and retry policy should not leak into the browser or override NodeAgent policy. | Provider adapter unit tests with mocked fetch, timeout, and max-byte handling. |
| `src/live/roomServer.ts` | Local HTTP/SSE live-room server, in-memory room store, turn loop, human steer, audio cache, and run token cancellation. | Partially adapt | Barge-in/run-token ideas can inform VoiceGateway. Discard the in-memory room store and mutation path. | This file is the biggest fork-drift risk because it owns rooms, utterances, traces, and scheduler state. | Browser test that voice uses NodeRoom job cards and Convex state, not a separate SSE room store. |
| `src/client/live/roomClient.ts` | Chooses Convex reactive client or HTTP/SSE local client at build time. | Adapt pattern only | NodeRoom already uses Convex; optional local dev voice transport can follow this pattern. | Conditional transport can hide production-only behavior if tests run only against HTTP. | One test for Convex-mode source of truth; one local mock transport test. |
| `convex/rooms.ts` | Convex room ledger for Room OS: bounded traces/utterances, mutations, internal actions, scheduler hops, stale-token checks. | Reuse lessons, not schema | NodeRoom Convex modules and NodeAgent job path remain canonical. Borrow bounded trace and stale-hop guard patterns. | Copying tables or mutations would create duplicate rooms, traces, goals, tasks, workers, and artifacts. | Convex boundary test that voice commands enter through existing NodeRoom mutations. |
| `convex/openai.ts` and `convex/coordinator.ts` | Non-deterministic OpenAI/STT/TTS work and worker coordination for Room OS. | Adapt only provider wrapper ideas | VoiceGateway STT/TTS adapters; NodeAgent still owns work execution. | Worker coordination overlaps NodeAgent and must not become the new agent runtime. | NodeAgent smoke plus voice adapter tests with no direct artifact writes. |
| `src/client/components/agents-ui/agent-audio-visualizer-bar.tsx` | Voice UI affordance for active audio. | Reuse design idea | Existing NodeRoom voice controls or a future voice overlay. | UI polish can ship before governance unless gated; keep it behind adapter readiness. | Browser visual smoke after voice UX is implemented. |
| `tests/roomReducer.test.ts` | Proves Room OS reducer behavior. | Adapt cases | VoiceSessionState and speech-act fallback tests. | Count-task expectations are not NodeRoom product behavior. | Port only acknowledgement-loop and turn-state cases. |
| `tests/liveSteering.test.ts` | Proves live human steer handling. | Adapt cases | RoomVoiceAdapter normalization and confirmation tests. | Room OS steer mutates the room goal; NodeRoom steer should create a governed command/job. | Test that voice retarget becomes a NodeRoom command with trace evidence. |
| `tests/nodeAgentMvp.test.ts` | Proves Room OS local NodeAgent artifact chain. | Discard as architecture owner; mine for examples only. | NodeRoom NodeAgent tests already own execution behavior. | High risk of importing a second NodeAgent model. | Existing `nodeagent:frame:smoke` and `omnigent:nodeagent:smoke`. |

## Compatibility Decisions

- Do not copy Room OS `RoomState` into NodeRoom.
- Do not copy Room OS `goals`, `tasks`, `workers`, or `artifacts` tables into
  NodeRoom.
- Do not make Room OS `roomServer.ts` the live backend for NodeRoom voice.
- Do reuse STT/TTS provider boundaries, timeout handling, byte caps, TTS
  best-effort behavior, run-token cancellation, and acknowledgement-loop guards.
- Do adapt speech-act classification into RoomCommand risk classification.
- Do keep every durable write behind existing NodeRoom command governance.

## Target File Plan

The first implementation slice added types and tests:

- `src/voice/types.ts`
- `src/voice/stateMachines.ts`
- `tests/voiceSession.test.ts`

The second slice added mocked adapters, the RoomStore bridge, browser speech
adapters, narration, and QA smoke:

- `src/voice/gateway.ts`
- `src/voice/roomVoiceAdapter.ts`
- `src/voice/commandClassifier.ts`
- `src/voice/narration.ts`
- `src/voice/adapters/mock.ts`
- `src/voice/adapters/browserSpeech.ts`
- `tests/roomVoiceAdapter.test.ts`
- `scripts/voice-qa-smoke.ts`

The third slice mounted voice in the chat composer and added authenticated
provider fallback endpoints. Native browser STT is preferred; provider STT/TTS
is available only through Convex HTTP routes that validate the room actor proof
and keep provider keys server-side:

- `src/ui/Chat.tsx`
- `src/app/styles.css`
- `src/app/store.tsx`
- `src/voice/adapters/providerHttp.ts`
- `src/voice/adapters/providerSpeech.ts`
- `convex/voice.ts`
- `convex/http.ts`
- `tests/chatVoiceComposer.test.tsx`
- `tests/voiceProviderHttp.test.ts`

## Acceptance Criteria For The Merge

- Typed chat still works.
- Existing NodeAgent workflows still work.
- Voice can trigger the same workflows as text through `RoomCommand`.
- Risky voice commands require confirmation or proposal.
- No Room OS code bypasses NodeRoom governance.
- No durable room mutation happens directly from the voice layer.
- Trace evidence records the heard transcript, confidence, source, and resulting
  NodeRoom job/proposal.
