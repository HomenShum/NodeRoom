# NodeRoom design system

An agent-readable spec of the UI — the `DESIGN.md` convention from
[open-design](https://github.com/nexu-io/open-design) (a local-first Claude-Design
alternative whose portable value is exactly this: prose a human or agent can read,
backed by tokens in code). The tokens live in `src/app/styles.css`; this is the
prose that mirrors them.

## 1. Color

Dark-first; `index.html` sets `data-theme="dark"`. Tokens in `:root` + `[data-theme="dark"]`.

- **Accent** — terracotta `--accent-primary #D97757` (+ `--accent-hover`, `--accent-tint`, `--accent-border`, `--accent-ink`). One accent, used for agents, primary actions, locks.
- **Surfaces** — `--bg-app / --bg-primary / --bg-secondary / --bg-tertiary / --bg-hover` (dark: `#09090b → #20262d`).
- **Ink** — `--text-primary / -secondary / -muted / -tertiary` (dark: `#f2f4f7 → #66717c`).
- **Semantic** — `--success #1F8A5B` / `--success-ink #2E9E6B` (commits, live, drafts merged), `--info #5E6AD2` / `--info-ink #8C92E0` (public/read). *Follow-up: migrate the ~10 remaining hardcoded greens/blues in styles.css to these tokens.*
- **Borders** — `--line`, `--line-strong`. Dark borders are light-alpha, not black.

## 2. Typography

- **UI** — Inter / Manrope (`--font-ui`). **Mono** — JetBrains Mono (`--font-mono`), used for codes, versions, trace detail.
- Scale (currently literal; ramp tokens are the follow-up): titles 12.5–14px/700, body 13.5px, meta 10.5–11px, kicker 10.5px uppercase `.16em`.

## 3. Spacing

4px base — `--space-1 … --space-20` (`src/app/styles.css`). New code references these; legacy `gap6/8/10/12` utilities keep their literals to avoid visual drift (migrate opportunistically).

## 4. Layout

The room is a 4-panel `.r-workspace` (12px gap, 12px pad). Panel widths: rail `224px` · public chat `flex 1.15` · artifact `flex 1.35` · private agent `320px`. Each panel is a rounded card (`--r 14px`) with `--shadow-md`. Collapses to a single chat column under 980px.

## 5. Components

| Component | Class | Notes |
|---|---|---|
| Panel card | `.r-panel` (`.left/.center/.artifact/.right`) | staggered `panelIn` reveal |
| Top bar | `.r-top` | logo · room code · segmented panel toggle · auto-allow · avatar stack · theme |
| Chat | `.r-chat` / `.r-msg` / `.r-bubble-ask` / `.r-composer` | avatars, agent tag, public `@nodeagent` mention, hidden `/ask`/`/free` compatibility aliases, route/model picker, **typing indicator** (`.r-typing`) |
| Spreadsheet | `.r-sheet` | CAS cells: `.locked` (NA badge) · `.draft` · `.committed` (wet-ink); `.r-val-pos` green; version pill |
| Trace | `.r-trace` | typed color-coded icons (lock/read/draft/commit/merge) |
| Switch / button / tag | `.r-switch` / `.r-btn` / `.r-tag` | one focus ring: `--focus-ring` |

## 6. Motion

- Curves — `--ease-out-expo` (reveals), `--ease-spring` (switch), `--ease-smooth`. Durations — `--motion-fast .12s / -base .18s / -slow .34s`.
- **Reduced motion** — a global `@media (prefers-reduced-motion: reduce)` disables all animation/transition. New animations must degrade to a static state under it (the typing dots become static).
- **React Bits adoption** — use only local wrappers in `src/ui/motion/*` (`NodeReveal`, `NodeCount`, `NodeTextReveal`) rather than direct app imports. The wrapper shape follows React Bits TS-CSS components but stays tokenized, dependency-light, and reduced-motion-safe.
- **Motion guardrails** — animate state comprehension only: landing proof, passive intelligence reveal, evidence/trace scanning. Do not animate spreadsheet cells, live editable text, literal evidence quotes, cursor trails, or heavy backgrounds inside the work room.

## 7. Voice

Terse, practitioner. Labels are nouns/verbs, not sentences. The agent narrates one line at start + finish. No hype.

## 8. Anti-patterns

- Don't force-scroll a feed when the user has scrolled up (we stick-to-bottom only when near bottom).
- Don't show a silent gap while the agent works — show in-flight state (typing / running).
- Don't hardcode a new green/blue/duration — add or reuse a token.
- Don't break `prefers-reduced-motion`.

## 9. UI audit — adopted from assistant-ui + open-design

Checked against [assistant-ui examples](https://www.assistant-ui.com/examples) and open-design.

**Adopted now (P0):**
- **Tool-lifecycle trace rows** (assistant-ui `ToolFallback`) — every trace step is a collapsible row; expand it for the structured `tool · args → result` detail + a status chip. The detail is carried on `TraceEvent.detail` (engine + Convex), so it works in both modes. `Artifact.tsx` `TraceRow`, `engine/roomEngine.ts`, `convex/*`.
- **Honest in-flight status** (assistant-ui) — a typing indicator replaces the old silent 700ms gap in the private agent reply (`src/ui/Chat.tsx`, `.r-typing`).
- **Stick-to-bottom** (assistant-ui) — both the chat feed and the trace strip only auto-scroll when the user is near the bottom (`Chat.tsx`, `Artifact.tsx` TraceStrip) — no more yanking users off history.
- **Token discipline** (open-design) — named spacing scale, semantic color, motion-duration, and focus-ring tokens added (`styles.css`); this `DESIGN.md` is the agent-readable pairing.

**Adopted now (P1):**
- **Slash-command menu** (assistant-ui trigger popover) — type `/` in the public composer for a discoverable command list (`.r-slash`, `Chat.tsx`).
- **Room-agent mention menu** — type leading `@nodeagent` or choose it from the leading `@` menu to start a public room action; `/ask` and `/free` are compatibility shims, not primary UI.
- **Message action bar** — hover any message for **Copy**; private agent messages get the **"Promote to public"** button the copy promised (`.r-msg-actions`, `Chat.tsx`).
- **Composer contract** — the input is a `<textarea>`: **Enter** sends, **Shift+Enter** newlines (auto-grows), **Esc** closes/blurs (`Chat.tsx`).
- **Mobile** — the top bar condenses and side panels collapse below 980/640px (no horizontal overflow at 375px; QA-verified).

**Adopted now (P2):**
- **Edit-in-place** — hover your own message for **Edit**; it becomes a textarea (Enter saves, Esc cancels) and patches via `editMessage` (engine + a Convex `messages.update` mutation, author-gated). `Chat.tsx` Bubble.
- **Honest error state** (HONEST_STATUS) — `applyEdit` now returns feedback; a hand edit that loses a CAS race shows a transient `.r-art-error` banner ("that cell changed — your edit was reverted") instead of silently vanishing. `Artifact.tsx`.
- **`aria-live`** on the trace strip + the chat feed, so screen readers announce new activity.

**Intentionally not built (off-model):**
- **Message retry/regenerate** and **branch switching** are 1:1 assistant-thread concepts (alternative generations of a single assistant's reply). NodeRoom is a multi-author shared room with one linear log, so they don't apply — re-asking is just sending again, and there are no branches to pick.
