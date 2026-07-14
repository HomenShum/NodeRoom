export type FinchJudgeRecord = {
  task_id?: string | number;
  score?: unknown;
  error?: unknown;
  resolved_judge_model?: unknown;
};

export type FinchJudgeDisagreementReport = ReturnType<typeof buildFinchJudgeDisagreement>;

export function buildFinchJudgeDisagreement(args: {
  canonical: FinchJudgeRecord[];
  shadow: FinchJudgeRecord[];
  generatedAt: string;
}) {
  const canonical = indexRecords(args.canonical);
  const shadow = indexRecords(args.shadow);
  const canonicalErrors = [...canonical.values()].filter(hasError).length;
  const shadowErrors = [...shadow.values()].filter(hasError).length;
  const shadowErrorCategories = [...shadow.values()]
    .filter(hasError)
    .reduce<Record<string, number>>((counts, record) => {
      const category = shadowErrorCategory(String(record.error));
      counts[category] = (counts[category] ?? 0) + 1;
      return counts;
    }, {});
  const compared: Array<{
    taskId: string;
    canonicalScore: 0 | 1;
    shadowScore: 0 | 1;
    shadowModel: string;
  }> = [];

  for (const [taskId, canonicalRecord] of canonical) {
    const shadowRecord = shadow.get(taskId);
    const canonicalScore = binaryScore(canonicalRecord);
    const shadowScore = binaryScore(shadowRecord);
    if (canonicalScore === null || shadowScore === null || !shadowRecord) continue;
    compared.push({
      taskId,
      canonicalScore,
      shadowScore,
      shadowModel: stringValue(shadowRecord.resolved_judge_model) || "unknown",
    });
  }

  const bothPass = compared.filter((row) => row.canonicalScore === 1 && row.shadowScore === 1).length;
  const bothFail = compared.filter((row) => row.canonicalScore === 0 && row.shadowScore === 0).length;
  const shadowOnlyPass = compared.filter((row) => row.canonicalScore === 0 && row.shadowScore === 1).length;
  const canonicalOnlyPass = compared.filter((row) => row.canonicalScore === 1 && row.shadowScore === 0).length;
  const canonicalPasses = bothPass + canonicalOnlyPass;
  const shadowPasses = bothPass + shadowOnlyPass;
  const agreement = bothPass + bothFail;

  const grouped = new Map<string, typeof compared>();
  for (const row of compared) {
    const rows = grouped.get(row.shadowModel) ?? [];
    rows.push(row);
    grouped.set(row.shadowModel, rows);
  }

  return {
    schema: "finch-judge-disagreement-v1",
    generatedAt: args.generatedAt,
    officialScoreClaim: false,
    canonicalContract: {
      model: "gpt-5-mini",
      version: "2025-08-07",
      contractId: "finch-gpt5mini-canonical-v1",
      role: "published Finch automated judge",
    },
    shadowContract: {
      router: "openrouter/free",
      role: "zero-cost disagreement audit",
      promotionAllowed: false,
      limitation: "The router may select a different compatible free model for each request.",
    },
    coverage: {
      canonicalRecords: canonical.size,
      shadowRecords: shadow.size,
      comparedRecords: compared.length,
      canonicalErrors,
      shadowErrors,
      canonicalOnlyRecords: [...canonical.keys()].filter((id) => !shadow.has(id)).length,
      shadowOnlyRecords: [...shadow.keys()].filter((id) => !canonical.has(id)).length,
    },
    scores: {
      canonicalPasses,
      canonicalPassRate: ratio(canonicalPasses, compared.length),
      shadowPasses,
      shadowPassRate: ratio(shadowPasses, compared.length),
      agreementCount: agreement,
      agreementRate: ratio(agreement, compared.length),
      disagreementCount: shadowOnlyPass + canonicalOnlyPass,
    },
    confusion: {
      bothPass,
      bothFail,
      shadowOnlyPass,
      canonicalOnlyPass,
    },
    shadowErrorCategories,
    byResolvedShadowModel: [...grouped.entries()]
      .map(([model, rows]) => {
        const modelAgreement = rows.filter((row) => row.canonicalScore === row.shadowScore).length;
        const modelPasses = rows.filter((row) => row.shadowScore === 1).length;
        return {
          model,
          cases: rows.length,
          agreementCount: modelAgreement,
          agreementRate: ratio(modelAgreement, rows.length),
          shadowPasses: modelPasses,
          shadowPassRate: ratio(modelPasses, rows.length),
        };
      })
      .sort((a, b) => b.cases - a.cases || a.model.localeCompare(b.model)),
    disagreements: compared
      .filter((row) => row.canonicalScore !== row.shadowScore)
      .map((row) => ({
        taskId: row.taskId,
        canonicalScore: row.canonicalScore,
        shadowScore: row.shadowScore,
        shadowModel: row.shadowModel,
      })),
  };
}

export function renderFinchJudgeDisagreement(report: FinchJudgeDisagreementReport): string {
  const rows = report.byResolvedShadowModel.length
    ? report.byResolvedShadowModel.map((item) =>
      `| \`${item.model}\` | ${item.cases} | ${formatRate(item.agreementRate)} | ${item.shadowPasses}/${item.cases} |`,
    ).join("\n")
    : "| _No comparable shadow responses_ | 0 | n/a | 0/0 |";

  return `# Finch Judge Disagreement Audit

This is a shadow reliability audit, not an official score. The canonical column is Finch's published GPT-5-mini judge contract; \`openrouter/free\` is zero-cost, capability-routed, and may resolve to a different model per request.

| Coverage | Canonical | Free-router shadow | Compared |
|---|---:|---:|---:|
| Records | ${report.coverage.canonicalRecords} | ${report.coverage.shadowRecords} | ${report.coverage.comparedRecords} |
| Parse/provider errors | ${report.coverage.canonicalErrors} | ${report.coverage.shadowErrors} | - |

| Result | Count | Rate |
|---|---:|---:|
| Exact pass/fail agreement | ${report.scores.agreementCount} | ${formatRate(report.scores.agreementRate)} |
| Canonical passes | ${report.scores.canonicalPasses} | ${formatRate(report.scores.canonicalPassRate)} |
| Shadow passes | ${report.scores.shadowPasses} | ${formatRate(report.scores.shadowPassRate)} |
| Disagreements | ${report.scores.disagreementCount} | ${formatRate(ratio(report.scores.disagreementCount, report.coverage.comparedRecords))} |

## Confusion

- Both pass: ${report.confusion.bothPass}
- Both fail: ${report.confusion.bothFail}
- Shadow-only pass: ${report.confusion.shadowOnlyPass}
- Canonical-only pass: ${report.confusion.canonicalOnlyPass}

## Resolved Models

| Free-router model | Cases | Agreement | Shadow passes |
|---|---:|---:|---:|
${rows}

## Shadow Availability Errors

${Object.keys(report.shadowErrorCategories).length
    ? Object.entries(report.shadowErrorCategories).map(([category, count]) => `- ${category}: ${count}`).join("\n")
    : "- none"}

Promotion is structurally disabled for this artifact. Use disagreement IDs for review; do not average this result into the canonical Finch score.
`;
}

function indexRecords(records: FinchJudgeRecord[]): Map<string, FinchJudgeRecord> {
  const result = new Map<string, FinchJudgeRecord>();
  for (const record of records) {
    const id = stringValue(record.task_id);
    if (id) result.set(id, record);
  }
  return result;
}

function binaryScore(record: FinchJudgeRecord | undefined): 0 | 1 | null {
  if (!record || hasError(record)) return null;
  return record.score === 0 || record.score === 1 ? record.score : null;
}

function hasError(record: FinchJudgeRecord): boolean {
  return typeof record.error === "string" && record.error.trim().length > 0;
}

function shadowErrorCategory(error: string): string {
  const normalized = error.toLowerCase();
  if (normalized.includes("rate limit") || normalized.includes("429")) return "rate_limit_or_daily_quota";
  if (normalized.includes("maximum context length") || normalized.includes("context")) return "context_limit";
  if (normalized.includes("no endpoints found that support image")) return "no_image_capable_endpoint";
  return "other_provider_or_parse_error";
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function formatRate(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}
