import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildProofloopBuyerValidationKit,
  scoreProofloopBuyerValidation,
  writeProofloopBuyerValidationKit,
  type ProofloopBuyerConversationSignal,
} from "../src/eval/proofloopBuyerValidation";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Proof Loop buyer validation", () => {
  it("keeps the corrected framing to five questions and verification language", () => {
    const kit = buildProofloopBuyerValidationKit({
      now: () => new Date("2026-07-05T00:00:00.000Z"),
    });

    expect(kit.schema).toBe("proofloop-buyer-validation-v1");
    expect(kit.questions).toHaveLength(5);
    expect(kit.oneLiner.toLowerCase()).toContain("proves your agent's work is real");
    expect(kit.oneLiner.toLowerCase()).not.toContain("certif");
    expect(kit.framingRule.toLowerCase()).toContain("verification you run");
    expect(kit.framingRule.toLowerCase()).toContain("not certification");
    expect(kit.questions.map((question) => question.id)).toEqual([
      "workflow-proof",
      "anti-gaming",
      "local-adoption",
      "receipt-sensitivity",
      "managed-trigger",
    ]);
  });

  it("requires demand, local adoption, and a budget owner before validating the wedge", () => {
    const score = scoreProofloopBuyerValidation([
      conversation("A", "workflow-team", true, true, true, true, true, false),
      conversation("B", "workflow-team", true, true, false, true, true, false),
      conversation("C", "regulated-platform", true, false, false, true, true, false),
      conversation("D", "solo-builder", false, false, false, false, false, false),
      conversation("E", "regulated-platform", false, false, false, false, true, true),
    ]);

    expect(score.recommendation).toBe("validated");
    expect(score.activePain).toBe(3);
    expect(score.wouldRunThisWeek).toBe(2);
    expect(score.namedBudgetOwner).toBe(1);
    expect(score.hardRejects).toBe(1);
  });

  it("blocks platform building when buyer demand is too weak", () => {
    const score = scoreProofloopBuyerValidation([
      conversation("A", "solo-builder", true, false, false, false, false, false),
      conversation("B", "solo-builder", false, false, false, false, false, false),
      conversation("C", "workflow-team", false, false, false, false, false, false),
      conversation("D", "workflow-team", false, false, false, false, false, true),
      conversation("E", "regulated-platform", false, false, false, false, true, true),
    ]);

    expect(score.recommendation).toBe("pivot-or-reframe");
    expect(score.reasons.join("\n")).toContain("buyers named active proof pain");
  });

  it("writes a local ignored worksheet kit", () => {
    const root = tempRoot();
    const kit = buildProofloopBuyerValidationKit({
      now: () => new Date("2026-07-05T00:00:00.000Z"),
    });
    const result = writeProofloopBuyerValidationKit(kit, { root });

    const jsonPath = join(root, result.jsonPath);
    const markdownPath = join(root, result.markdownPath);
    expect(result.jsonPath).toBe(".proofloop/intake/buyer-validation/kit.json");
    expect(result.markdownPath).toBe(".proofloop/intake/buyer-validation/kit.md");
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(markdownPath)).toBe(true);
    expect(JSON.parse(readFileSync(jsonPath, "utf8")).questions).toHaveLength(5);
    expect(readFileSync(markdownPath, "utf8")).toContain("Proof Loop proves your agent's work is real");
  });
});

function conversation(
  buyer: string,
  profile: ProofloopBuyerConversationSignal["profile"],
  activePain: boolean,
  wouldRunThisWeek: boolean,
  namedBudgetOwner: boolean,
  wouldPayForManagedPrivateReceipts: boolean,
  dataResidencyOrByokRequired: boolean,
  hardReject: boolean,
): ProofloopBuyerConversationSignal {
  return {
    buyer,
    profile,
    activePain,
    wouldRunThisWeek,
    namedBudgetOwner,
    wouldPayForManagedPrivateReceipts,
    dataResidencyOrByokRequired,
    hardReject,
  };
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-buyer-validation-"));
  tempRoots.push(root);
  return root;
}
