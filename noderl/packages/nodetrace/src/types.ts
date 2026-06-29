/**
 * Live-capture pipeline — shared contracts.
 *
 * Our own observe/act/extract loop over a real page, provider-agnostic on BOTH seams:
 *   - ReasoningModel: any LLM (Claude / GPT / …) that returns a STRUCTURED decision. The model
 *     reasons over a compact page representation (+ optional screenshot); it never touches the browser.
 *   - BrowserSubstrate: the thing that actually opens/observes/acts on a page (Browserbase+Playwright
 *     for interactive capture, Firecrawl for screenshot+extract only). Swapped without touching the loop.
 *
 * Every step yields a CaptureStep carrying the screenshot + the normalized box of the element acted on
 * or extracted from — which maps 1:1 onto the Trace tab's TraceAttachment.box overlay.
 */
import type { ZodType } from "zod";

/** Normalized (0..1) region of the page — same convention as TraceAttachment.box. `page` is set for
 *  PDF citations (which page the box lives on); absent for screenshot-space boxes. Top-left, y-down. */
export interface NormBox { x: number; y: number; w: number; h: number; page?: number }

export type CaptureStatus = "ok" | "warn" | "risk";

/** What the model wants to find on the page (natural-language + optional hints). */
export interface ObserveTarget {
  description: string;
  role?: string;
  text?: string;
  selectorHint?: string;
}

/** A target the substrate has resolved to a concrete on-screen region. */
export interface LocatedTarget extends ObserveTarget {
  box: NormBox;
  selector: string;
}

/** An action the model decided to take. */
export interface ActStep {
  kind: "click" | "type" | "scroll" | "press";
  target?: ObserveTarget;
  value?: string;
}

/** One unit of work the loop emits — feeds straight into the Trace tab (screenshot + box overlay). */
export interface CaptureStep {
  phase: string;
  label: string;
  status: CaptureStatus;
  detail?: string;
  /** Raw PNG bytes; the producer/Convex action persists these (Convex storage / /public) and sets a url. */
  screenshotPng?: Uint8Array;
  box?: NormBox;
  log?: string;
  ms?: number;
}

export interface CaptureResult {
  ok: boolean;
  url: string;
  title?: string;
  steps: CaptureStep[];
  data?: Record<string, unknown>;
  /** Present (and ok=false) on failure — honest status, never a fake success. */
  error?: string;
}

/** The page as the model sees it: a compact a11y/text representation + an optional screenshot for vision. */
export interface ReasoningContext {
  url: string;
  title: string;
  a11y: string;
  screenshot?: { png: Uint8Array; width: number; height: number };
}

/** Provider-agnostic decision-maker. The ONE method: given context, return JSON matching a schema. */
export interface ReasoningModel {
  name: string;
  decide<T>(opts: {
    system: string;
    instruction: string;
    context: ReasoningContext;
    schema: ZodType<T>;
    signal?: AbortSignal;
  }): Promise<T>;
}

/** What a browser backend must provide for the loop to drive it. */
export interface BrowserSubstrate {
  name: string;
  /** interactive=false (Firecrawl) → loop skips act() and goes straight to a single observe+extract. */
  capabilities: { interactive: boolean };
  open(url: string, signal: AbortSignal): Promise<PageHandle>;
}

export interface PageHandle {
  representation(): Promise<{ url: string; title: string; a11y: string }>;
  screenshot(): Promise<{ png: Uint8Array; width: number; height: number }>;
  /** Resolve a described element to its on-screen box (null if not found). */
  locate(target: ObserveTarget): Promise<LocatedTarget | null>;
  /** Perform the action; return the acted element's box when known (for the trace overlay). */
  act(action: ActStep): Promise<{ box?: NormBox } | void>;
  close(): Promise<void>;
}
