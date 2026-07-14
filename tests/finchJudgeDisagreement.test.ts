import { describe, expect, it } from "vitest";
import { buildFinchJudgeDisagreement } from "../src/eval/finchJudgeDisagreement";

describe("Finch judge disagreement", () => {
  it("separates canonical scores from non-promotable free-router disagreement evidence", () => {
    const report = buildFinchJudgeDisagreement({
      generatedAt: "2026-07-10T00:00:00.000Z",
      canonical: [
        { task_id: "a", score: 1, resolved_judge_model: "gpt-5-mini-2025-08-07" },
        { task_id: "b", score: 0, resolved_judge_model: "gpt-5-mini-2025-08-07" },
        { task_id: "c", score: 0, error: "parse", resolved_judge_model: "gpt-5-mini-2025-08-07" },
      ],
      shadow: [
        { task_id: "a", score: 1, resolved_judge_model: "model/vision-free" },
        { task_id: "b", score: 1, resolved_judge_model: "model/vision-free" },
        { task_id: "d", score: 0, resolved_judge_model: "model/other-free" },
        { task_id: "e", error: "429 rate limit exceeded" },
      ],
    });

    expect(report.officialScoreClaim).toBe(false);
    expect(report.coverage).toMatchObject({
      canonicalRecords: 3,
      shadowRecords: 4,
      comparedRecords: 2,
      canonicalErrors: 1,
      shadowErrors: 1,
      canonicalOnlyRecords: 1,
      shadowOnlyRecords: 2,
    });
    expect(report.scores).toMatchObject({
      canonicalPasses: 1,
      shadowPasses: 2,
      agreementCount: 1,
      agreementRate: 0.5,
      disagreementCount: 1,
    });
    expect(report.confusion).toEqual({
      bothPass: 1,
      bothFail: 0,
      shadowOnlyPass: 1,
      canonicalOnlyPass: 0,
    });
    expect(report.shadowErrorCategories).toEqual({ rate_limit_or_daily_quota: 1 });
    expect(report.disagreements).toEqual([
      { taskId: "b", canonicalScore: 0, shadowScore: 1, shadowModel: "model/vision-free" },
    ]);
  });
});
