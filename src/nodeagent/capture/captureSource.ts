/**
 * captureSource — one call: pick a substrate from the environment (Browserbase if its keys are set,
 * else Firecrawl), run the observe/act/extract loop with the default reasoner, return a CaptureResult.
 * Substrate + reasoner are injectable for tests / bring-your-own-model. Honest: with no substrate
 * configured it returns ok:false with a clear remediation, never a fake success.
 */
import { runCapture } from "./pipeline";
import { aiSdkReasoner } from "./reasoning";
import { pickSubstrate } from "./substrate";
import type { BrowserSubstrate, CaptureResult, ReasoningModel } from "./types";

export async function captureSource(opts: {
  url: string;
  goal: string;
  reasoner?: ReasoningModel;
  substrate?: BrowserSubstrate;
  modelId?: string;
  allowHosts?: string[];
  maxSteps?: number;
  budgetMs?: number;
  now?: () => number;
}): Promise<CaptureResult> {
  const substrate = opts.substrate ?? pickSubstrate();
  if (!substrate) {
    return {
      ok: false,
      url: opts.url,
      error: "no capture substrate configured",
      steps: [{ phase: "Error", label: "no capture substrate configured", status: "risk", detail: "set BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID (interactive) or FIRECRAWL_API_KEY (screenshot-only)" }],
    };
  }
  const reasoner = opts.reasoner ?? aiSdkReasoner(opts.modelId);
  return runCapture({
    url: opts.url,
    goal: opts.goal,
    reasoner,
    substrate,
    allowHosts: opts.allowHosts,
    maxSteps: opts.maxSteps,
    budgetMs: opts.budgetMs,
    now: opts.now,
  });
}
