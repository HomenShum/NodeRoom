import type { AccessibilityLayer, GateStatus, PerformanceLayer } from "./designQuality";

export const BROWSER_EVIDENCE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export type BrowserFinding = { surface: string; severity: "P0" | "P1" | "P2"; check: string; detail: string };

export type BrowserViewportEvidence = {
  name: string;
  width: number;
  height: number;
  screenshot: string;
  domSnapshot: string;
  textLength: number;
  scrollWidth: number;
  clientWidth: number;
  cls: number;
  longTasks: number;
};

export type BrowserEvidence = {
  schema: 1;
  runId: string;
  commitSha: string;
  sourceTreeHash: string;
  generatedAt: string;
  appUrl: string;
  serverMode: string;
  capture: {
    status: GateStatus;
    screenshots: string[];
    domSnapshots: string[];
    viewports: BrowserViewportEvidence[];
    findings: BrowserFinding[];
  };
  performance: PerformanceLayer;
  accessibility: AccessibilityLayer;
};

export type BrowserEvidenceFreshness = {
  valid: boolean;
  reason: string;
  ageMs?: number;
};

export function validateBrowserEvidence(
  evidence: BrowserEvidence | undefined,
  opts: {
    currentSourceTreeHash: string;
    requestedAppUrl: string;
    nowMs?: number;
    maxAgeMs?: number;
  },
): BrowserEvidenceFreshness {
  if (!evidence) return { valid: false, reason: "missing" };
  if (evidence.schema !== 1) return { valid: false, reason: "schema_mismatch" };
  if (!evidence.sourceTreeHash) return { valid: false, reason: "missing_source_tree_hash" };
  if (evidence.sourceTreeHash !== opts.currentSourceTreeHash) {
    return { valid: false, reason: "source_tree_hash_mismatch" };
  }
  if (!targetMatches(evidence.appUrl, opts.requestedAppUrl)) {
    return { valid: false, reason: "app_url_mismatch" };
  }
  const generatedMs = Date.parse(evidence.generatedAt);
  if (!Number.isFinite(generatedMs)) return { valid: false, reason: "invalid_generated_at" };
  const nowMs = opts.nowMs ?? Date.now();
  const ageMs = Math.max(0, nowMs - generatedMs);
  const maxAgeMs = opts.maxAgeMs ?? BROWSER_EVIDENCE_MAX_AGE_MS;
  if (ageMs > maxAgeMs) return { valid: false, reason: "too_old", ageMs };
  return { valid: true, reason: "current", ageMs };
}

function targetMatches(evidenceAppUrl: string, requestedAppUrl: string) {
  if (!/^https?:\/\//i.test(requestedAppUrl) || requestedAppUrl === "local") return true;
  return normalizeUrl(evidenceAppUrl) === normalizeUrl(requestedAppUrl);
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname === "/") url.pathname = "";
    return url.toString();
  } catch {
    return value;
  }
}
