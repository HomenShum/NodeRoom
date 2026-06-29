# Episode brief — `noderoom-analyst-room-v1`

**Audience:** the solo operator / banker / investor / founder who lives in messy inbound — leads, intros,
founder updates, renewal notices, data rooms — and needs to know *what to do next today*.

**Thesis:** NodeRoom owns the **temporary, high-context work session**. Drop messy signals; leave with a
ranked, **sourced** action brief. It is not Airtable, not Clay, not a CRM, not an inbox — it is the
*scratch-to-decision room* that sits **before and around** those systems.

**The wedge loop this episode walks, end to end:**

| Stage | What the viewer sees | Honesty status |
| --- | --- | --- |
| Capture | RoomHome command center — drop/paste/note/upload (real `memoryDemo` footage) | live footage |
| Research | the agent fills a sourced, named-column grid | claim card (engine real; surface seeded) |
| Brief | today's ranked action list | claim card (packet engine real; dedicated tab is roadmap) |
| Evidence | the versioned, locked, CAS-guarded write path | **real repo code** (`convex/artifacts.ts`) |
| Handoff | export brief / draft reply / push approved rows | claim card |

**Why some scenes are claim cards, honestly:** the *ranked "Today's Brief"* and the *handoff draft-body*
exist today as engine (`bankerCoachPacket.ts`, `downstreamHandoff.ts`) but not yet as first-class UI
surfaces — so this episode narrates the value the room produces rather than faking a screen that does not
exist. The Evidence scene shows the **actual** guard code from the repo. The Capture scene is **real**
deterministic footage. This is the pipeline's sanctioned honest treatment: real footage + real code +
honest cards, never fabricated app screens.

**Audio:** narration via OpenAI TTS (`gpt-4o-mini-tts`, voice `onyx`); background music is the shared
original ambient bed (`assets/audio/episode-bed.mp3`), mixed under the voice at low gain with eased
in/out (`remotion/Episode.tsx`).

**Outputs:** YouTube Short / LinkedIn (1080×1920 vertical), README GIF.

**Regenerate (one command):** `npm run episode -- noderoom-analyst-room-v1`
(chains `episode:voiceover` → `episode:assemble` → `episode:render` → `episode:judge`;
add `--skip-voiceover` to reuse existing narration, `--skip-judge` to skip the Gemini judge).
The Capture footage is refreshed separately: `npm run walkthroughs -- room-home && npm run walkthroughs:render -- room-home`.
