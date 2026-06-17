# Convex Components + Evidence Pipeline Research

## Research status

This note captures the implementation direction after reviewing the current NodeRoom schema and the external Convex component ecosystem.

## Why Firecrawl scrape was added

Firecrawl is the fastest practical source-capture layer for NodeRoom's banker-grade evidence workflow. It gives the agent a clean, source-shaped artifact from a URL: Markdown for LLM context, optional HTML for audit/debug, screenshot evidence for human review, and a content hash for staleness/delta checks.

NodeRoom should treat Firecrawl as a capture primitive, not as truth by itself. The truth object is an EvidenceFact / CellPayload / OKF concept that points back to the source capture.

| Without Firecrawl scrape | With Firecrawl scrape |
|---|---|
| Raw `fetch()` returns noisy HTML, often missing JavaScript-rendered content. | The agent gets clean Markdown/HTML/screenshot from the source page. |
| The LLM sees browser chrome, nav menus, scripts, and unrelated text. | The LLM sees a compact source packet that is easier to cite. |
| A source URL is easy to store but hard for a banker to visually verify. | Evidence Carousel can show a screenshot/source snapshot next to the claim. |
| Staleness is just TTL guesswork. | We can hash captured content and refresh only when the page materially changes. |
| If a claim is challenged, the agent may only have a snippet. | The source capture becomes a durable artifact with locator/citation metadata. |
| Every future agent may scrape the same page again. | Captures can be deduped by URL + contentHash + visibility + policy. |

## Component adoption map

| Component / service | Use in NodeRoom | Adopt now? | Why |
|---|---|---:|---|
| `@convex-dev/agent` | Durable thread/message abstraction for long-lived AI agents. | Not as a replacement yet | NodeRoom already has custom `agentJobs`, `agentRuns`, `agentReasoningFrames`, `entityWorkItems`, OKF tools, and managed CAS writes. Consider adapter later for standard thread storage or multi-agent message history. |
| `@convex-dev/workflow` | Durable fire-and-forget workflows for passive note scanning, source capture, and long-running diligence. | Yes, design target | Workflows checkpoint steps, retry individual failures, and survive restarts. This maps to passive typing -> noteworthiness -> entity work -> evidence capture. |
| `@convex-dev/workpool` | Concurrency limits for Linkup/Firecrawl/Transloadit/provider calls. | Yes, for external API fanout | It prevents a user or agent burst from spawning too many expensive external requests. |
| `@convex-dev/action-retrier` | Retry isolated idempotent actions. | Optional | Useful for single unreliable calls, but Workflow/Workpool are better for multi-step diligence. |
| Debounce via scheduled functions / app-level debouncer | Debounce idle notebook/sheet edits before noteworthiness scanning. | Yes | We need keyed server-side debounce by source object so typing does not trigger an agent on every keystroke. |
| Convex File Storage | Canonical raw file/source artifact storage. | Yes | Store uploaded PDFs/XLSX/CSVs, Firecrawl markdown/html/screenshot outputs, Transloadit results, and generated walkthrough artifacts. |
| `@transloadit/convex` | Large upload + media/document processing pipeline. | Later / targeted | Use when files are large, need resumable upload, video/audio/image transformations, thumbnails, OCR-ish media processing, or Uppy upload UX. Keep Convex File Storage for canonical refs. |

## Passive noteworthiness workflow

```text
User types in notebook/sheet
  -> client debounces local flush
  -> Convex mutation commits node/cell version
  -> server keyed debounce schedules noteworthiness scan
  -> scanner re-reads latest committed version
  -> if not noteworthy: index only / no external calls
  -> if noteworthy: entityWorkItems + agentJob / workflow
  -> workflow checks entityResearchCache + OKF first
  -> Firecrawl/Linkup only if evidence is missing or stale
  -> clean writes go through managed CAS / proposals
  -> OKF and retrieval indexes update
```

## Implementation principle

Use components as infrastructure primitives. Do not let them bypass NodeRoom's product invariants:

- no raw agent writes to shared artifacts
- no source-less verified claims
- no private-to-public leaks
- no duplicate external research when cache is fresh
- no agent triggered on every keystroke
- no long external work inside mutations
