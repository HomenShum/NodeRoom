# Parity — the capture → comment → repair → verify → export loop

_Vision capture (2026-06-19). Parity generalizes the comment-edit loop that the `powerpoint` skill's HTML now instantiates: take any product surface, repair scoped slices with proof, and export before touching production code. This doc preserves the spec so it isn't lost; we are **not** building all of Parity for the BotLearn contest (hero stays the deck skill)._

## One-liner
**Prove before implementation.** Capture or import a running UI surface, pin/comment a scoped slice, let the agent repair just that slice, read the Parity Coach impact + parity score + quality-gate, rerun verification, and export a **proof packet** — all before changing production code.

## Inputs — capture / import (normalized into editable `ui_kits/<slug>/`)
- Running app captured through **MCP**
- A canonical kit
- A **Claude Design-style** skill pack
- An **Open CoDesign-style** export
- Plain **HTML handoff ZIP**
- **Figma bridge** JSON/ZIP (or Figma REST file JSON)
- A source **screenshot**

Parity normalizes all of these into editable `ui_kits/<slug>/` surfaces and writes `parity.project.json`. You can switch **web / mobile / workspace / CLI** surfaces, then comment, edit, verify, and export again.

## Entry modes
- **From a prompt:** describe the surface → pipeline generates, decomposes, verifies, streams the result.
- **From an image:** attach a screenshot/generated image → decompose into a componentized `ui_kit`.
- **Import a kit / handoff ZIP:** canonical kit, Claude Design pack, Open CoDesign export, or plain HTML ZIP → preserved per `ui_kits/<slug>/`.
- **Figma bridge round-trip:** import a Parity bridge JSON/ZIP or Figma REST JSON; export a bridge ZIP (`figma/manifest.json`, `code.js`, `ui.html`, token metadata, `parity-figma-bridge.json`).

## The core loop
1. **Preview + comment:** comment mode pins a **bbox** on the preview or leaves a free-form note scoped to a selected file.
2. **Scoped repair:** chat the agent stream, enhance prompts, or trigger an **advisor/executor** fix from a comment, file, or manual request — repair the scoped slice only.
3. **Verify with Parity Coach:** read the **end-user impact readout, parity score, top recommendations, quality-gate status** instead of raw low-level check rows.
4. **Export proof packet** before touching production code.

## Supporting surfaces
- **Model route:** Balanced / Best Quality / Free, a preset model, or a custom provider/model id (Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, Cerebras, xAI, Mistral).
- **Session privacy + BYOK:** browser-tab-only provider-key placeholders; copy local MCP env setup; clear keys; fresh session. **Hosted Parity does not receive browser-entered BYOK secrets for model calls.**
- **Projects & run history:** left rail — start runs, revisit recent runs, run status, session-level project list.
- **Files view:** browse / create / edit / save / revert `ui_kits/<slug>/` files, design revision history, source-image preview, selected-file scope, inline editing, ZIP export.
- **Inspiration workflow:** search curated or live references, review product patterns, apply a **safe inspiration brief** (improve the kit **without copying source assets**).
- **Sync stale snapshots:** version-control modal patches the current run or copies **MCP recapture** instructions when the original app route changed.
- **Language:** English / Simplified Chinese UI + localized Parity Coach readouts.

## How it maps to the skill suite (the connection)
The `powerpoint` skill is the **first concrete instance** of this loop:

| Parity concept | Deck-skill instantiation (already built) |
|---|---|
| Editable surface (`ui_kits/<slug>/`) | `deck/index.html` generated from the structured `deck_plan.json` |
| Pin/bbox-targetable slice | stable `slide-N` / `s{N}c{M}` ids on every slide & claim |
| Proof layer | provenance mini-standard: `data-status` (`verified\|manual\|needs_review`) + hoverable `data-source` |
| Parity Coach quality gate | `evidence_pass.py` (honesty gate: refuse fabrication, emit `NEEDS_REVIEW.md`) |
| Scoped repair | edit the plan slice → re-gate → re-render (don't hand-edit generated HTML) |
| Export | PDF (share) · `build_pptx.py` (native-editable) |

**Strategic throughline:** since the `SKILL.md` format and even the generators (e.g. `frontend-slides`) are commoditizing, NodeRoom's edge is this **governance/proof loop** layered on top — not the generator. Parity is that loop generalized from slides to any UI surface. See `docs/research/agent-skills-landscape.md`.
