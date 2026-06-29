/**
 * Per-phase model selection for orchestrator-worker pattern.
 *
 * Orchestrator phases (intake/plan/verify/synthesize) use AGENT_ORCHESTRATOR_MODEL.
 * Worker phases (execute) use AGENT_WORKER_MODEL.
 * Falls back to the job's resolved model policy when env vars are unset.
 */

const ORCHESTRATOR_PHASES = new Set(["intake", "plan", "verify", "synthesize"]);

export function modelForFramePhase(
  phase: string,
  fallback: string,
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): string {
  if (ORCHESTRATOR_PHASES.has(phase)) {
    const orchestratorModel = env.AGENT_ORCHESTRATOR_MODEL?.trim();
    if (orchestratorModel) return orchestratorModel;
  }
  if (phase === "execute") {
    const workerModel = env.AGENT_WORKER_MODEL?.trim();
    if (workerModel) return workerModel;
  }
  return fallback;
}

export { ORCHESTRATOR_PHASES };
