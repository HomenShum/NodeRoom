# Live capture pipeline — our own observe / act / extract

**Goal.** When the agent retrieves a value from a live source (an SEC filing, a web page), capture a
**screenshot with a highlight box on the exact element** the value came from — visual provenance that
renders in the Trace tab (Flow graph + Steps). Do it through **our own reasoning loop**, not a vendor's
black box, so we can swap the reasoning model and the browser independently.

> Design from first principles. Homen — you mentioned a Meta-era approach for the act/extract/observe
> pipeline on LinkedIn; I couldn't read it, so this is a clean-room design. Paste the specifics and I'll
> reconcile (esp. how you framed the observe→act loop and the element-grounding step).

## Two seams, swappable independently

```
                ┌──────────────────────────── runCapture() loop ────────────────────────────┐
   goal, url ──▶│  observe ─▶ act ─▶ observe ─▶ … ─▶ extract                                  │──▶ CaptureStep[]
                │     │         │                      │                                       │   (screenshot + box)
                └─────┼─────────┼──────────────────────┼───────────────────────────────────────┘
                      ▼         ▼                      ▼
              ReasoningModel  BrowserSubstrate   BrowserSubstrate
              (decide JSON)   (act on page)      (representation + screenshot + locate)
```

- **ReasoningModel** (`capture/reasoning.ts`) — *judgement*. One method: `decide({system, instruction,
  context, schema}) → T`. It reasons over a compact page representation (+ screenshot for vision models)
  and returns a **structured** decision. Default `aiSdkReasoner` routes to Claude/GPT via the Vercel AI
  SDK (already a dep); the model id picks the provider. **Bring your own model** = swap this impl.
- **BrowserSubstrate** (`capture/substrate/*`) — *the browser*. `open(url) → PageHandle` with
  `representation() / screenshot() / locate(target) / act(action) / close()`. The loop never knows which
  browser it's driving.

The loop (`capture/pipeline.ts`) owns **reliability**; the model owns **judgement**; the substrate owns
the **browser**. Each turn emits a `CaptureStep` carrying the screenshot + the normalized `box` of the
element acted on / extracted from — which is exactly `TraceAttachment.box` in the Trace tab.

## The three verbs

| verb | who | what |
|---|---|---|
| **observe** | model reads `representation()` (+ screenshot) | proposes the next action, or `done` |
| **act** | substrate executes click/type/scroll/press | captures screenshot + the acted element's box |
| **extract** | model reads the final page | returns structured fields + the **verbatim source text** each came from → `locate()` resolves that to a box |

## Substrate choice — Firecrawl vs Browserbase

| | Firecrawl (`firecrawlSubstrate`) | Browserbase (`browserbaseSubstrate`) |
|---|---|---|
| call | one REST POST (no SDK) | cloud Chrome via Playwright/CDP |
| interactive | ❌ (extract-only) | ✅ click/type/scroll |
| screenshot | ✅ | ✅ |
| **exact box** | ❌ (no element coords) | ✅ `boundingBox()` → normalized |
| runs inside Convex | ✅ (pure `fetch`) | ❌ (needs a Node host for playwright-core) |
| cost | low | Browserbase session + LLM tokens |
| use when | "screenshot the source, fast" | "box exactly where it clicked" |

`pickSubstrate()` prefers Browserbase when its keys are set, else Firecrawl, else `null` → the caller
returns `ok:false` with remediation (never a fake success).

Production runner wiring is intentionally split:

- `PRODUCTION_ROOM_TOOLS` stays browser-safe for memory-mode demos and does **not** include
  `capture_source`.
- `SERVER_PRODUCTION_ROOM_TOOLS` is imported by `convex/agent.ts` and `convex/agentJobRunner.ts`; it adds
  a Convex-safe `capture_source` tool that imports `runCapture + firecrawlSubstrate + aiSdkReasoner`
  directly and never imports Browserbase/Playwright.
- Browserbase remains the exact-box worker substrate for producer jobs and walkthrough capture, not the
  default Convex action path.

## Where it runs

- **Firecrawl path → Convex action.** Pure `fetch`, so a Convex `internalAction` can run it and persist
  steps + screenshots directly. Import the *specific* modules (`runCapture`, `firecrawlSubstrate`,
  `aiSdkReasoner`) — **not** the barrel — so Convex's bundler never pulls `playwright-core`.
- **Browserbase path → Node worker / producer.** `playwright-core` needs a Node host, so drive it from
  `scripts/qa-trace/capture-live.ts` (or a Fly/Cloud Run worker). Convex orchestrates + persists; the
  worker does the browser. This is the same shape as our existing qa-trace producers.

## Reliability floor (the 8-point checklist)

| gate | where |
|---|---|
| **BOUND** | `CAPTURE_LIMITS.MAX_STEPS` (12) caps the act loop; `MAX_EXTRACT_FIELDS` (64) |
| **TIMEOUT** | one wall-clock budget (`AbortController` + `now() >= deadline`) across the whole run |
| **SSRF** | `assertCapturableUrl` rejects non-http(s), localhost/`*.local`/`*.internal`, private IP literals; optional **host allowlist** is the real control for the remote browser |
| **BOUND_READ** | `clipRepresentation` caps model input; `MAX_SCREENSHOT_BYTES` caps image bytes |
| **HONEST_STATUS** | any failure → `{ ok:false, error }` + a `risk` Error step; never a fake success |
| **ERROR_BOUNDARY** | the loop is wrapped in try/catch/finally; the page is always closed |
| **HONEST_SCORES** | extraction uses `null` for absent fields (no invented values); `warn` tone on nulls |
| **DETERMINISTIC** | substrate + reasoner are injectable → the loop is unit-tested with mocks (no live browser) |

**SSRF note.** Unlike `fetchSource` (which fetches from *our* network and DNS-pins to public IPs), the
substrate runs *remotely* — the IP-pin trick doesn't apply. Our controls are (1) reject obviously-internal
URLs as defense-in-depth and (2) the allowlist. Full name→private protection for the remote fetch is the
provider's responsibility + the allowlist.

## Trace-tab integration

`CaptureStep { phase, label, status, screenshotPng, box }` → `TraceStep { group, label, status,
attachments:[{kind:"screenshot", url, box}] }`. `capture-live.ts` writes the PNGs to
`/public/qa-trace/live` and emits a bundle in `qaTraceBundles/` — it appears as a Trace record with the
Flow graph + Steps + the highlight overlay, no UI change needed.

## Convex wiring recipe (ready to apply, needs deploy)

```ts
// convex/convex.config.ts   (only if you want Firecrawl's reactive cache component)
import firecrawl from "convex-firecrawl-scrape/convex.config.js";
app.use(firecrawl);

// convex/capture.ts  — Firecrawl path (pure fetch; safe in Convex)
"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { runCapture } from "../src/nodeagent/capture/pipeline";
import { firecrawlSubstrate } from "../src/nodeagent/capture/substrate/firecrawl";
import { aiSdkReasoner } from "../src/nodeagent/capture/reasoning";

export const captureSource = internalAction({
  args: { roomId: v.id("rooms"), url: v.string(), goal: v.string() },
  handler: async (ctx, { roomId, url, goal }) => {
    const r = await runCapture({ url, goal, reasoner: aiSdkReasoner(), substrate: firecrawlSubstrate() });
    for (const s of r.steps) {
      const storageId = s.screenshotPng ? await ctx.storage.store(new Blob([s.screenshotPng], { type: "image/png" })) : undefined;
      await ctx.runMutation(/* agentSteps:record */, { roomId, tool: "capture_source", step: s, storageId });
    }
    return { ok: r.ok, data: r.data, error: r.error };
  },
});
```

## Env vars

| var | for | get it |
|---|---|---|
| `FIRECRAWL_API_KEY` | Firecrawl substrate | firecrawl.dev/app/api-keys |
| `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` | Browserbase substrate | browserbase.com/settings |
| `ANTHROPIC_API_KEY` *(or `OPENAI_API_KEY`)* | the reasoner | console.anthropic.com / platform.openai.com |

Set with `npx convex env set <NAME> <value>` (Convex side) and/or your shell/CI for the Node worker.

## Status — verified vs. needs keys

- **Verified now:** the loop contract, bounds, honest failure, time budget, non-interactive path, and
  SSRF guard — `tests/capturePipeline.test.ts` (10 tests, mock reasoner + substrate). `tsc` clean.
- **Needs keys + network (yours to run):** a live capture against a real page (`capture-live.ts`), and
  the Convex action (needs deploy). SEC EDGAR 403s undeclared automation — use Browserbase (real browser
  UA) or SEC's data API. I can't verify these from the sandbox; I won't claim they work until we run them.
