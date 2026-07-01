import { verifyImmutability } from "./scaffoldApply";

export type ScaffoldGateMode = "advisory" | "strict";

export interface ScaffoldGateResult {
  mode: ScaffoldGateMode;
  ok: boolean;
  blocking: boolean;
  advisory: boolean;
  violations: string[];
}

/**
 * The immutable-file policy is a hard gate only while applying scaffold repair
 * proposals. In ordinary PRs it is advisory: harness and CI owners may still
 * intentionally edit the proof machinery, but the review should call it out.
 */
export function evaluateScaffoldGate(
  changedFiles: string[],
  mode: ScaffoldGateMode = "advisory",
): ScaffoldGateResult {
  const immutability = verifyImmutability(changedFiles);
  const hasViolations = immutability.violations.length > 0;
  const blocking = mode === "strict" && hasViolations;
  return {
    mode,
    ok: !blocking,
    blocking,
    advisory: mode === "advisory" && hasViolations,
    violations: immutability.violations,
  };
}
