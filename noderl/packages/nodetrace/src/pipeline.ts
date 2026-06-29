/**
 * runCapture — our own observe → act → extract loop. The loop owns reliability; the model owns
 * judgement; the substrate owns the browser. Each turn:
 *   1. observe  — read the page representation (+ screenshot) → the model proposes the next action
 *   2. act      — execute it on the substrate, capture the screenshot + the acted element's box
 *   3. extract  — once the model says "done", pull the structured fields + the box each came from
 *
 * Every CaptureStep carries a screenshot + box → renders in the Trace tab (Flow graph + Steps) with
 * the highlight overlay. Failures return { ok:false, error } with the steps captured so far — never a
 * fake success (HONEST_STATUS). Bounded on steps + a single wall-clock budget (BOUND + TIMEOUT).
 */
import { z } from "zod";
import type { BrowserSubstrate, CaptureResult, CaptureStep, PageHandle, ReasoningModel } from "./types";
import { CAPTURE_LIMITS, assertCapturableUrl, clipRepresentation } from "./guards";

const TargetSchema = z.object({
  description: z.string(),
  role: z.string().optional(),
  text: z.string().optional(),
  selectorHint: z.string().optional(),
});

const DecisionSchema = z.object({
  thought: z.string(),
  done: z.boolean(),
  action: z.object({
    kind: z.enum(["click", "type", "scroll", "press"]),
    target: TargetSchema.optional(),
    value: z.string().optional(),
  }).optional(),
});

const ExtractSchema = z.object({
  fields: z.array(z.object({
    name: z.string(),
    value: z.union([z.string(), z.number(), z.null()]),
    sourceText: z.string().optional(),
  })),
});

const ACT_SYSTEM =
  "You drive a web browser to accomplish a goal. Reason over the page (accessibility tree + screenshot) " +
  "and return ONE next action, or done=true when the information needed is on screen. Prefer the fewest " +
  "actions. When you target an element, describe it precisely (text + role) so it can be located.";

const EXTRACT_SYSTEM =
  "You extract structured data from the current page. For EACH field, return the exact verbatim on-page " +
  "text it came from in sourceText, so it can be located and highlighted. Do not invent values; use null " +
  "when a field is not present.";

function actLabel(a: { kind: string; target?: { description: string }; value?: string }): string {
  const t = a.target?.description ? ` "${a.target.description}"` : "";
  return a.kind === "type" ? `type ${a.value ?? ""}${t}` : `${a.kind}${t}`;
}

export async function runCapture(opts: {
  url: string;
  goal: string;
  reasoner: ReasoningModel;
  substrate: BrowserSubstrate;
  maxSteps?: number;
  budgetMs?: number;
  allowHosts?: string[];
  now?: () => number;
}): Promise<CaptureResult> {
  const now = opts.now ?? Date.now;
  const budgetMs = Math.min(opts.budgetMs ?? CAPTURE_LIMITS.TOTAL_BUDGET_MS, CAPTURE_LIMITS.TOTAL_BUDGET_MS);
  const maxSteps = Math.min(opts.maxSteps ?? CAPTURE_LIMITS.MAX_STEPS, CAPTURE_LIMITS.MAX_STEPS);
  const deadline = now() + budgetMs;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), budgetMs);
  const steps: CaptureStep[] = [];
  let page: PageHandle | undefined;

  try {
    const url = assertCapturableUrl(opts.url, { allowHosts: opts.allowHosts });
    page = await opts.substrate.open(url.toString(), ctl.signal);

    // ── observe / act ────────────────────────────────────────────────────────────
    if (opts.substrate.capabilities.interactive) {
      for (let i = 0; i < maxSteps; i++) {
        if (now() >= deadline) { steps.push({ phase: "Act", label: "time budget exhausted", status: "warn" }); break; }
        const started = now();
        const rep = await page.representation();
        const shot = await page.screenshot();
        const decision = await opts.reasoner.decide({
          system: ACT_SYSTEM,
          instruction: opts.goal,
          context: { url: rep.url, title: rep.title, a11y: clipRepresentation(rep.a11y), screenshot: shot },
          schema: DecisionSchema,
          signal: ctl.signal,
        });
        if (decision.done || !decision.action) {
          steps.push({ phase: "Observe", label: decision.thought || "ready to extract", status: "ok", screenshotPng: shot.png, ms: now() - started });
          break;
        }
        const acted = await page.act(decision.action);
        const box = acted?.box ?? (decision.action.target ? (await page.locate(decision.action.target))?.box : undefined);
        steps.push({ phase: "Act", label: actLabel(decision.action), detail: decision.thought, status: "ok", screenshotPng: shot.png, box, ms: now() - started });
      }
    }

    // ── extract ──────────────────────────────────────────────────────────────────
    const rep = await page.representation();
    const shot = await page.screenshot();
    const extracted = await opts.reasoner.decide({
      system: EXTRACT_SYSTEM,
      instruction: opts.goal,
      context: { url: rep.url, title: rep.title, a11y: clipRepresentation(rep.a11y), screenshot: shot },
      schema: ExtractSchema,
      signal: ctl.signal,
    });
    const data: Record<string, unknown> = {};
    for (const f of extracted.fields.slice(0, CAPTURE_LIMITS.MAX_EXTRACT_FIELDS)) {
      data[f.name] = f.value;
      const loc = f.sourceText ? await page.locate({ description: f.name, text: f.sourceText }) : null;
      steps.push({ phase: "Extract", label: `${f.name} = ${f.value ?? "∅"}`, detail: f.sourceText, status: f.value === null ? "warn" : "ok", screenshotPng: shot.png, box: loc?.box ?? undefined });
    }
    return { ok: true, url: rep.url, title: rep.title, steps, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    steps.push({ phase: "Error", label: "capture failed", status: "risk", detail: message });
    return { ok: false, url: opts.url, steps, error: message };
  } finally {
    clearTimeout(timer);
    if (page) await page.close().catch(() => { /* best-effort */ });
  }
}
