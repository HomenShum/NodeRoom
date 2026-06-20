import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Feature = {
  id: string;
  area: string;
  claim: string;
  status: string;
  productionGate: string;
  deterministicChecks: string[];
  liveChecks: string[];
  evidence: Array<{ type: string; ref: string }>;
  nextReview: string;
};
type Matrix = {
  features: Feature[];
  modelLadder: {
    source: string | string[];
    routes: Array<{ modelRoute: string; provider: string; l1: string; l2: string; l3: string; l4: string; recommendedUse?: string }>;
  };
};

const root = process.cwd();
const matrix = JSON.parse(readFileSync(join(root, "docs/qa/production-matrix.json"), "utf8")) as Matrix;

describe("production QA matrix", () => {
  it("is appendable, evidence-backed, and status-normalized", () => {
    const ids = new Set<string>();
    const allowedStatuses = new Set(["green", "yellow", "red"]);

    for (const feature of matrix.features) {
      expect(feature.id).toMatch(/^[a-z0-9_]+$/);
      expect(ids.has(feature.id), `${feature.id} is duplicated`).toBe(false);
      ids.add(feature.id);

      expect(feature.area).toBeTruthy();
      expect(feature.claim).toBeTruthy();
      expect(allowedStatuses.has(feature.status), `${feature.id} has invalid status`).toBe(true);
      expect(feature.productionGate).toBeTruthy();
      expect(feature.deterministicChecks.length, `${feature.id} needs deterministic checks`).toBeGreaterThan(0);
      expect(feature.liveChecks.length, `${feature.id} needs live check policy, even if not applicable`).toBeGreaterThan(0);
      expect(feature.evidence.length, `${feature.id} needs evidence refs`).toBeGreaterThan(0);
      expect(feature.nextReview).toBeTruthy();

      for (const evidence of feature.evidence) {
        expect(existsSync(join(root, evidence.ref)), `${feature.id} evidence missing: ${evidence.ref}`).toBe(true);
      }
    }
  });

  it("keeps the live model ladder gate explicit", () => {
    const sources = Array.isArray(matrix.modelLadder.source) ? matrix.modelLadder.source : [matrix.modelLadder.source];
    for (const source of sources) {
      expect(existsSync(join(root, source)), `model ladder source missing: ${source}`).toBe(true);
    }
    const statuses = new Set(["PASS", "FAIL", "TIMEOUT", "SKIP"]);

    for (const route of matrix.modelLadder.routes) {
      expect(route.modelRoute).toBeTruthy();
      expect(route.provider).toBeTruthy();
      for (const rung of [route.l1, route.l2, route.l3, route.l4]) {
        expect(statuses.has(rung), `${route.modelRoute} has invalid rung status ${rung}`).toBe(true);
      }
    }
  });

  it("does not hide free-auto router coverage behind generic model rows", () => {
    const longRunning = matrix.features.find((feature) => feature.id === "long_running_free_auto");
    expect(longRunning, "long_running_free_auto matrix row is missing").toBeTruthy();
    expect(longRunning!.liveChecks.some((check) => check.includes("openrouter/free-auto") || check.includes("ladder:free"))).toBe(true);

    const routes = matrix.modelLadder.routes.map((route) => route.modelRoute);
    expect(routes).toContain("openrouter/free-auto");
    expect(routes.some((route) => /free-auto.*top|top.*free-auto/i.test(route))).toBe(true);
  });

  it("keeps qa:matrix:check labeled as docs-sync, not primary quality evidence", () => {
    for (const feature of matrix.features) {
      if (feature.status !== "green") continue;
      expect(
        feature.deterministicChecks[0]?.includes("qa:matrix:check"),
        `${feature.id} uses the docs-sync drift command as primary green evidence`,
      ).toBe(false);
    }
  });

  it("renders manual or missing live checks as graph gaps instead of green coverage", () => {
    const script = readFileSync(join(root, "scripts/qa-matrix.ts"), "utf8");
    const browserE2E = matrix.features.find((feature) => feature.id === "browser_e2e_dogfood");

    expect(browserE2E?.status).toBe("yellow");
    expect(browserE2E?.liveChecks).toContain("npm run test:product:memory");
    expect(browserE2E?.liveChecks.some((check) => /^missing:/i.test(check))).toBe(true);
    expect(script).toContain("executedLiveCheck");
    expect(script).toContain("manual browser");
    expect(script).toContain("missing:");
    expect(script).toContain("f.liveChecks.some(executedLiveCheck)");
  });

  it("keeps the Convex interactive fallback on a ladder-safe route", () => {
    const source = readFileSync(join(root, "convex/agent.ts"), "utf8");
    const match = source.match(/AGENT_MODEL\s*\?\?\s*"([^"]+)"/);
    expect(match, "convex/agent.ts must declare an explicit AGENT_MODEL fallback").toBeTruthy();
    const fallback = match![1];
    const route = matrix.modelLadder.routes.find((r) => r.modelRoute === fallback);
    expect(route, `${fallback} is not recorded in the model ladder`).toBeTruthy();
    expect([route!.l1, route!.l2, route!.l3, route!.l4], `${fallback} is not L1-L4 safe`).toEqual([
      "PASS",
      "PASS",
      "PASS",
      "PASS",
    ]);
  });

  it("publishes the generated QA cockpit from README", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    expect(readme).toContain("docs/qa/production-matrix.json");
    expect(readme).toContain("docs/eval/qa-coverage.svg");
    expect(readme).toContain("docs/eval/model-ladder-matrix.svg");
    expect(readme).toContain("docs/PRODUCTION_GUARANTEE_MATRIX.md");
  });
});
