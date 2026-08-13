# Canonical journeys — NodeRoom

Five real workflows. Not feature tours: a journey is one person, one goal, and
the artifact they hold when it worked. These are the promotion loop's work queue,
exercised in order of importance.

**A journey with no browser evidence is unfinished**, regardless of test status.

All five run against the keyless in-memory build — no Convex deployment, no model
key — which is what a stranger who clones this repo can actually reach:

    npm install
    npm run dev            # http://127.0.0.1:5260
    # or the production build the baseline timed:
    npm run build && npx vite preview --port 4310

## Journey shape

Each journey states, in this order:

- **Persona and situation** — who arrived, and why today.
- **Goal** — what they want to be true when they leave.
- **Steps** — what they actually do, in the UI, in order.
- **Done when** — the observable artifact or state that proves completion.
- **Evidence** — path to the capture that shows it working. Empty until proven.

---

## J1 — "Show me the thing before I commit an evening to it"

- **Persona and situation:** A deal-team analyst has a link and four minutes
  between meetings. They will not create an account, and they will not read a
  README, to find out whether this is worth a second look.
- **Goal:** See a real, populated collaborative room — a spreadsheet with numbers
  in it, people in it, an AI assistant in it — without signing in or configuring
  anything.
- **Steps:**
  1. Open `/?mode=memory` (route gate: `src/landing/boot.ts`, `appSearchPattern`).
  2. Click **Try sample room** (`data-testid="start-demo-room"`).
- **Done when:** The three-pane room renders with the seeded "Q3 diligence"
  content: the binder listing 9 artifacts, the `Q3 variance` sheet showing
  Revenue/COGS/Gross profit/OpEx/Net income for Q2 and Q3, the room chat with 7
  seeded messages, the presence strip reading "5 live", and "Room trace · 26
  events" — with no console error and no failed request.
- **Evidence:** `evidence/baseline/j1-landing-desktop.png`,
  `evidence/baseline/j1-room-desktop.png`,
  `evidence/baseline/prod-room-desktop.png` (production build, room rendered
  184ms after the click). **PASSES at baseline.**

## J2 — "Prove the no-clobber claim on one screen"

- **Persona and situation:** A skeptical engineer read the pitch — "the agent and
  the human never silently overwrite each other" — and wants that demonstrated in
  a single interaction rather than argued in prose.
- **Goal:** Edit a cell by hand, ask the assistant to recompute the column that
  depends on it, and see the assistant keep the human edit rather than clobber it.
- **Steps:**
  1. Open `/#story` (the low-commitment first-impression route; the repo's own
     gate for it is `npm run qa:story` → `scripts/story-route-dogfood.mjs`).
  2. Type `13,250` into the cell labelled **Q3 revenue cell C2**.
  3. Type `Recompute the revenue variance` into **Story agent prompt** and click
     `data-testid="story-agent-send"`.
- **Done when:** `data-testid="story-variance-cell"` reads `3,250`, the transcript
  says it *kept the human C2 edit*, and the line `Computed D2 = C2 - B2 = 3,250.`
  is visible.
- **Evidence:** `evidence/baseline/j2-story-before.png`,
  `evidence/baseline/j2-story-after.png`. **PASSES at baseline.**

## J3 — Receipt journey: "Ask the assistant to fill the variance column, then check its work"

- **Persona and situation:** The analyst from J1 now wants the boring part done:
  the variance column is empty and the board read is tomorrow.
- **Goal:** Ask in plain language, get the cells filled, and be able to see
  afterwards exactly what the assistant changed and that it released its lock.
- **Steps:**
  1. From the sample room (J1), click the chat composer
     (`data-testid="chat-composer"`).
  2. Type `@nodeagent recompute the Q3 variance column` and click
     `data-testid="chat-send"` (`/ask …` and `/free …` are the equivalent forms —
     `parsePublicNodeAgentRequest` in `src/ui/Chat.tsx`).
- **Done when:** The VARIANCE column fills with `+24%`, `+27.5%`, `+21.7%`,
  `+22.4%`; a Room NodeAgent message reads
  `Committed r_rev +24%, r_cogs +27.5%, r_gp +21.7%, r_ni +22.4%. Lock released.`;
  the trace counter increases (26 → 34 events); and the status bar reads
  `Room NodeAgent · reconciled Q3 variance · v42`.
- **Evidence:** `evidence/baseline/j3-agent-reply.png`,
  `evidence/baseline/prod-agent-receipt.png` (1,719ms from send to receipt).
  At baseline this **passed on the artifact but not where the user was looking** —
  defect D-1: the reply sorted above the seeded transcript and was off-screen in
  that same capture. **Fixed in iteration 1.** The receipt is now the last line of
  the chat and in view: `evidence/iteration-1/j3-chat-order-after.png` (with the
  defect state kept alongside it as `j3-chat-order-before.png`). Re-runnable:
  `node scripts/promotion-chat-order-proof.mjs --base-url http://127.0.0.1:4305`.

## J4 — Steering journey: "Nothing the assistant writes lands until I say so"

- **Persona and situation:** A host is willing to let an assistant touch the deal
  sheet only if she reviews each change first. DEMO.md §4.2 promises exactly this:
  auto-allow off by default, agent edits arriving as proposals the host approves
  or rejects, with a conflict surfaced instead of a false "applied".
- **Goal:** Turn auto-allow off (`data-testid="auto-allow-switch"`), have the
  assistant propose an edit, open **Review queue**
  (`data-testid="binder-review-queue"`), approve one and reject one, and see each
  outcome reflected in the sheet.
- **Done when:** An approved proposal applies to the named cell and a rejected one
  does not, both visible in the room trace.
- **Evidence:** **NOT DRIVABLE at baseline.** In the keyless sample room the review
  queue reads "no pending proposals" and no control found in the UI produces one;
  proposals appear to require the live Convex tier, which needs a deployment and a
  model key this wave deliberately did not create.
  `evidence/baseline/j4-review-queue.png`. This is the highest-value journey to
  make reachable in the keyless build.

## J5 — "Same room, from a phone, between meetings"

- **Persona and situation:** The same analyst, on the train, opening the link a
  colleague sent.
- **Goal:** Reach the room's work and the review items from a phone without
  pinch-zooming a desktop layout.
- **Steps:**
  1. Open `/?mode=memory` at a phone width (412×915, Pixel 7).
  2. Use the bottom navigation (`mobile-nav-room`, `mobile-nav-agent`,
     `mobile-nav-inbox`) to reach the room and its review items.
- **Done when:** The phone layout is the purpose-built mobile shell — its own
  header, bottom nav, card home — with no horizontal scrolling, and one item can
  be opened and acted on from it.
- **Evidence:** `evidence/baseline/landing-mobile.png` (mobile shell renders,
  `scrollWidth === innerWidth === 412`, zero console errors),
  `evidence/baseline/landing-w320.png`, `evidence/baseline/landing-w360.png`.
  **PARTIAL at baseline:** the shell was observed, but no task was completed on it.

---

## Journeys every agent surface owes

- **Recovery** — **not covered by a passing journey.** Two recovery surfaces exist
  in code and neither could be triggered in the keyless build: the boot shell's
  failed state (`markBootState("failed")` in `src/landing/boot.ts`, which replaces
  the shimmer with "Could not open the room" and a Reload button) and the agent
  failure card (`data-testid="agent-error"` with Retry / Adaptive / Free /
  Copy diagnostics). Wave 2 should force one — a chunk load failure or a killed
  model route — because a recovery path that has never been seen rendered is a
  claim, not a state.
- **Steering** — J4, above. Not drivable at baseline.
- **Receipt** — J3, above. Drivable and passing, with defect D-1 attached.
