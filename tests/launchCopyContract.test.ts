import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("launch copy contract", () => {
  it("does not present scripted content as live or promise anonymous access in protected launch rooms", () => {
    const paths = [
      "src/ui/Landing.tsx",
      "src/landing/roomTour/RoomTourFlows.tsx",
      "src/landing/roomTour/roomTourData.ts",
      "index.html",
    ];
    const text = paths.map((path) => readFileSync(join(process.cwd(), path), "utf8")).join("\n");

    for (const forbidden of ["Live demo", "Public by default", "no account · join as guest", "LIVE ROOM", "Seeding artifacts"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).toContain("Synthetic walkthrough");
    expect(text).toContain("Protected rooms ask members to sign in");
    expect(text).toContain("Checking room access");
  });

  it("keeps the expired finance batch historical until a real provider rerun restores it", () => {
    const paths = [
      "README.md",
      "docs/AGENT_EVAL.md",
      "docs/WORKFLOW_PREVIEWS.md",
      "docs/eval/PROFESSIONAL_WORKFLOW_EVALS.md",
      "docs/PRODUCTION_GUARANTEE_MATRIX.md",
    ];
    const text = paths.map((path) => readFileSync(join(process.cwd(), path), "utf8")).join("\n");

    for (const forbidden of [
      "The live scoreboard is the point",
      "Current full live promotion",
      "The current full Solve promotion is",
      "✅ **3-statement modeling test · Solve mode**",
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).toContain("not a current launch promotion");
    expect(text).toContain("No full live route is currently launch-promoted");
  });
});
