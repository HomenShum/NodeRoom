import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attachBtbGeminiJudgeResults } from "../src/solo/btbGeminiJudgeAttach";
import { freshRoomProofPath, readFreshRoomProofReceipt, writeFreshRoomProofReceipt, type FreshRoomProofReceipt } from "../src/eval/freshRoomProofReceipts";
import { btbFreshRoomTaskReceiptPath } from "../src/solo/btbFreshRoomMatrix";

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-btb-gemini-"));
  roots.push(root);
  return root;
}

describe("BTB Gemini judge receipt attachment", () => {
  it("maps judged BTB matrix videos back to fresh-room receipts", () => {
    const cwd = process.cwd();
    const projectRoot = tempProject();
    process.chdir(projectRoot);
    try {
      const taskId = "a31173e3-e8aa-4ddb-b0d9-e4e7055c950b";
      const videoPath = join(projectRoot, "test-results", "bankertoolbench", "matrix", taskId, "playwright-output", "case", "video.webm");
      const screenshotPath = join(projectRoot, "proof.png");
      const tracePath = join(projectRoot, "trace.json");
      const summaryPath = join(projectRoot, "docs", "eval", "gemini-media-judges", "btb-selective", "summary.md");
      mkdirSync(dirname(videoPath), { recursive: true });
      mkdirSync(dirname(summaryPath), { recursive: true });
      writeFileSync(videoPath, "webm");
      writeFileSync(screenshotPath, "png");
      writeFileSync(tracePath, "{}");
      writeFileSync(summaryPath, "# summary\n");

      const receipt = validBtbReceipt(taskId, screenshotPath, tracePath);
      writeFreshRoomProofReceipt(receipt, btbFreshRoomTaskReceiptPath(taskId));
      writeFreshRoomProofReceipt(receipt, freshRoomProofPath("FR-020"));

      const judgePath = join(projectRoot, "docs", "eval", "gemini-media-judges", "latest.json");
      writeFileSync(judgePath, JSON.stringify({
        runId: "btb-selective",
        command: "npm run media:gemini-judge -- --input video.webm",
        results: [{
          status: "judged",
          score: 14,
          maxScore: 16,
          asset: { path: videoPath, relPath: "test-results/bankertoolbench/matrix/a31173e3/video.webm" },
          judge: {
            verdict: "publish",
            summary: "Live room evidence is visible.",
            defects: [],
          },
        }],
      }, null, 2));

      const result = attachBtbGeminiJudgeResults({ judgePath });
      const updated = readFreshRoomProofReceipt(btbFreshRoomTaskReceiptPath(taskId));
      const latest = JSON.parse(readFileSync(join(projectRoot, freshRoomProofPath("FR-020")), "utf8")) as FreshRoomProofReceipt;

      expect(result.updated).toHaveLength(1);
      expect(updated?.visualJudge).toMatchObject({
        verdict: "pass",
        scorecardPath: summaryPath,
      });
      expect(updated?.ui.videoPaths).toContain(videoPath);
      expect(updated?.gatesProven).toContain("visual_judge_handoff");
      expect(latest.visualJudge?.verdict).toBe("pass");
    } finally {
      process.chdir(cwd);
    }
  });
});

function validBtbReceipt(taskId: string, screenshotPath: string, tracePath: string): FreshRoomProofReceipt {
  return {
    schema: 1,
    caseId: "FR-020",
    benchmark: "bankertoolbench",
    taskId,
    generatedAt: "2026-06-24T00:00:00.000Z",
    baseUrl: "http://127.0.0.1:5273",
    command: "npx playwright test",
    memoryMode: false,
    freshness: {
      roomCreatedAfterRunStart: true,
      forbiddenPreloadedArtifactsAbsent: true,
      artifactsCreatedFresh: ["package.xlsx"],
    },
    ui: {
      focusModeEnabled: true,
      attentionOverlayVisible: true,
      streamingVisible: true,
      screenshotPaths: [screenshotPath],
      tracePath,
    },
    artifacts: {},
    scorer: {
      name: "BankerToolBench proof verifier",
      verdict: "pass",
      details: {
        taskCoverage: {
          ok: true,
          requiredTickers: [],
          missingTickers: [],
          detail: "no multi-entity ticker coverage gate required",
        },
      },
    },
    visualJudge: {
      verdict: "not_run",
      reason: "unit test",
    },
    gatesProven: [
      "fresh_room_join",
      "public_nodeagent_invocation",
      "visible_streaming_progress",
      "trace_video_artifacts",
      "no_memory_mode_shortcut",
      "focus_mode_enabled",
      "focus_box_or_attention_overlay",
      "artifact_placeholder_scan",
      "agent_terminal_quality_gate",
    ],
    passed: true,
  };
}
