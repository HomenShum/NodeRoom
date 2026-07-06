import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectProofloopArtifactHandoff } from "../src/eval/proofloopArtifactHandoff";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ProofLoop artifact handoff", () => {
  it("packages receipts, screenshots, and Playwright video into a handoff manifest", () => {
    const root = tempRoot();
    writeFile(join(root, ".proofloop", "runs", "r1", "proximitty-prod-browser", "scorecard.md"), "# Scorecard\n");
    writeFile(join(root, ".proofloop", "runs", "r1", "proximitty-prod-browser", "browser-proof.json"), "{\"ok\":true}\n");
    writeFile(join(root, ".proofloop", "runs", "r1", "proximitty-prod-browser", "visual-proof.png"), "png");
    writeFile(join(root, "test-results", "proofloop-live", "video.webm"), "webm");

    const manifest = collectProofloopArtifactHandoff({
      root,
      runId: "r1",
      suite: "proximitty-prod-browser",
      convertVideo: false,
      requireVideo: true,
      now: () => new Date("2026-07-06T00:00:00.000Z"),
    });

    expect(manifest.status).toBe("ready");
    expect(manifest.videos).toHaveLength(1);
    expect(manifest.receipts.map((file) => file.handoffPath).sort()).toEqual([
      ".proofloop/runs/r1/handoff/receipts/proximitty-prod-browser/browser-proof.json",
      ".proofloop/runs/r1/handoff/receipts/proximitty-prod-browser/scorecard.md",
    ]);
    expect(manifest.screenshots.map((file) => file.handoffPath)).toEqual([
      ".proofloop/runs/r1/handoff/screenshots/proximitty-prod-browser/visual-proof.png",
    ]);
    expect(existsSync(join(root, ".proofloop", "runs", "r1", "handoff", "artifact-manifest.json"))).toBe(true);
    expect(readFileSync(join(root, ".proofloop", "runs", "r1", "handoff", "HANDOFF.md"), "utf8")).toContain("Video Evidence");
  });

  it("fails closed when video evidence is required but missing", () => {
    const root = tempRoot();
    writeFile(join(root, ".proofloop", "runs", "r2", "suite", "scorecard.md"), "# Scorecard\n");

    expect(() => collectProofloopArtifactHandoff({
      root,
      runId: "r2",
      suite: "suite",
      requireVideo: true,
      now: () => new Date("2026-07-06T00:00:00.000Z"),
    })).toThrow(/missing video evidence/);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-handoff-"));
  tempRoots.push(root);
  return root;
}

function writeFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}
