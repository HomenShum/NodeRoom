# Episode report — `noderoom-analyst-room-v1`

**Title:** The live analyst room: messy signals in, a sourced action brief out
**Format:** 1080×1920 vertical · 74.6s · H.264 + AAC (OpenAI TTS narration + original ambient music bed, mixed)
**Render:** `episodes/noderoom-analyst-room-v1/renders/short.mp4` (~9.4 MB)

## Scene ledger (honesty status per scene)

| # | Scene | Treatment | Source of truth |
| --- | --- | --- | --- |
| 1 | cold-open | claim card | the daily-problem framing (`docs/WEDGE.md`) |
| 2 | capture | **live footage** | `docs/walkthroughs/room-home.mp4` (deterministic `memoryDemo` capture, `specs.ts#room-home`) |
| 3 | research | claim card | research engine: `store.askAgent` → `runtime.ts` (real); seeded surface |
| 4 | brief | **live footage** | `docs/walkthroughs/brief.mp4` — the new Brief surface (`specs.ts#brief`) over packet engine `bankerCoachPacket.ts` |
| 5 | evidence | **real repo code** | `convex/artifacts.ts` `applyCellEditCore` (LOCK → CAS → proposal), extracted at assemble time |
| 6 | handoff | claim card | XLSX export real (`Artifact.tsx`); draft-body engine `downstreamHandoff.ts` (not yet UI-wired) |
| 7 | closing | claim card | the wedge thesis |

> Honest treatment: live footage where a surface exists, **real** repo code for the proof beat, and claim
> cards (never fabricated screens) for engine-but-not-yet-a-surface stages — see `brief.md`.

## Audio
- **Narration:** OpenAI TTS `gpt-4o-mini-tts`, voice `onyx` (calm narrator). 7 scenes, ~64s narration.
- **Music:** shared original ambient pad `assets/audio/episode-bed.mp3` (ffmpeg-generated, level-normalized
  to mean ≈ −20 dB), mixed under the voice at `MUSIC_VOL` with eased in/out (`remotion/Episode.tsx`).

## Verification (anti-shallow)
- **Deterministic (ffmpeg `volumedetect`):** 6/6 music-only tail windows audible (mean −28 to −33 dB);
  narration windows ≈ −24 dB ⇒ voice rides ~6-9 dB on top of the bed. Whole-mix mean −25.5 dB.
- **Gemini video judge (`judge.md`):** **15/16, verdict "publish"** — audio 2/2 ("voiceover clear…
  background ambient track is subtle and does not compete"), proof_feel 2/2 (live footage + real code).
  Lone defect: **P2** vertical legibility of the desktop UI in the capture scene.

## Regenerate
```
# narration (OpenAI TTS) + assemble (stages music bed) + render + judge, one command:
npm run episode -- noderoom-analyst-room-v1
# reuse existing narration / skip judge:
npm run episode -- noderoom-analyst-room-v1 --skip-voiceover --skip-judge
# refresh the Capture footage (deterministic, offline):
npm run walkthroughs -- room-home && npm run walkthroughs:render -- room-home
```
Keys resolve from `.env.local` (gitignored): `OPENAI_API_KEY` (TTS) and `GOOGLE_GENERATIVE_AI_API_KEY` (judge).
