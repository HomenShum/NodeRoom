import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import readline from "node:readline";

const WORK_ROOT = resolve(".tmp/underwriting-hmda-dc-2025");
const RAW_DIR = join(WORK_ROOT, "raw");
const PACKET_DIR = join(WORK_ROOT, "live-packet");
const RAW_CSV = join(RAW_DIR, "hmda-dc-2025-action-taken-1-3-purchase.csv");
const LEGACY_DOWNLOAD = resolve(".tmp/underwriting-hmda-dc-2025-head.csv");
const SOURCE_URL =
  "https://ffiec.cfpb.gov/v2/data-browser-api/view/csv?states=DC&years=2025&actions_taken=1,3&loan_purposes=1";
const PER_CLASS = Number(process.env.UNDERWRITING_PACKET_PER_CLASS ?? 5);

const LABELS = {
  "1": "originated",
  "3": "denied",
};

const FEATURE_COLUMNS = [
  "activity_year",
  "state_code",
  "county_code",
  "census_tract",
  "conforming_loan_limit",
  "derived_loan_product_type",
  "derived_dwelling_category",
  "preapproval",
  "loan_type",
  "loan_purpose",
  "lien_status",
  "loan_amount",
  "loan_to_value_ratio",
  "property_value",
  "income",
  "debt_to_income_ratio",
  "applicant_credit_score_type",
  "co-applicant_credit_score_type",
  "submission_of_application",
  "initially_payable_to_institution",
  "aus-1",
  "construction_method",
  "occupancy_type",
  "total_units",
  "tract_population",
  "tract_minority_population_percent",
  "ffiec_msa_md_median_family_income",
  "tract_to_msa_income_percentage",
  "tract_owner_occupied_units",
  "tract_one_to_four_family_homes",
  "tract_median_age_of_housing_units",
];

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function digestFile(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function missingScore(row) {
  const required = [
    "loan_amount",
    "loan_to_value_ratio",
    "property_value",
    "income",
    "debt_to_income_ratio",
    "loan_type",
    "loan_purpose",
    "lien_status",
    "occupancy_type",
  ];
  return required.reduce((n, key) => {
    const v = String(row[key] ?? "").trim();
    return n + (v === "" || v.toUpperCase() === "NA" ? 1 : 0);
  }, 0);
}

function parseNumeric(value) {
  const s = String(value ?? "").trim();
  if (!s || s.toUpperCase() === "NA" || /^exempt$/i.test(s)) return null;
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function dtiRiskScore(value) {
  const s = String(value ?? "").trim();
  if (!s || s.toUpperCase() === "NA" || /^exempt$/i.test(s)) return null;
  if (/^<20%$/.test(s)) return -1;
  if (/^20%-<30%$/.test(s)) return 0;
  if (/^30%-<36%$/.test(s)) return 1;
  if (/^36%-<40%$/.test(s)) return 2;
  if (/^40%-<50%$/.test(s)) return 3;
  if (/^50%-60%$/.test(s)) return 4;
  if (/^>60%$/.test(s)) return 5;
  const n = parseNumeric(s);
  if (n == null) return null;
  if (n < 20) return -1;
  if (n < 30) return 0;
  if (n < 36) return 1;
  if (n < 40) return 2;
  if (n <= 50) return 3;
  if (n <= 60) return 4;
  return 5;
}

function underwritingRiskScore(row) {
  const dti = dtiRiskScore(row.debt_to_income_ratio);
  const ltv = parseNumeric(row.loan_to_value_ratio);
  const income = parseNumeric(row.income);
  if (dti == null || ltv == null || income == null) return null;

  let score = dti * 2;
  if (ltv >= 100) score += 5;
  else if (ltv >= 95) score += 4;
  else if (ltv >= 80) score += 3;
  else if (ltv >= 60) score += 2;
  else if (ltv >= 40) score += 1;
  else score -= 1;

  if (income < 25) score += 4;
  else if (income < 50) score += 3;
  else if (income < 80) score += 2;
  else if (income < 120) score += 1;
  else if (income > 500) score -= 2;
  else if (income > 250) score -= 1;

  if (String(row.derived_loan_product_type ?? "").includes("Subordinate")) score += 1;
  if (String(row.preapproval ?? "") === "1") score -= 1;
  return score;
}

function selectionSortKey(row) {
  return createHash("sha256")
    .update(`hmda-dc-2025-underwriting:${row.__sourceRowNumber}`)
    .digest("hex");
}

async function ensureRawDownload() {
  mkdirSync(RAW_DIR, { recursive: true });
  if (existsSync(RAW_CSV)) return;
  if (existsSync(LEGACY_DOWNLOAD)) {
    await copyFile(LEGACY_DOWNLOAD, RAW_CSV);
    return;
  }

  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`HMDA download failed: ${response.status} ${response.statusText}`);
  const body = await response.text();
  writeFileSync(RAW_CSV, body);
}

async function loadRows() {
  const rows = [];
  let headers = [];
  let sourceRowNumber = 0;
  const rl = readline.createInterface({ input: createReadStream(RAW_CSV), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!headers.length) {
      headers = parseCsvLine(line);
      continue;
    }
    if (!line.trim()) continue;
    sourceRowNumber += 1;
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
    row.__sourceRowNumber = sourceRowNumber;
    rows.push(row);
  }
  return { headers, rows };
}

function selectRows(rows) {
  const byLabel = { "1": [], "3": [] };
  for (const row of rows) {
    const label = String(row.action_taken ?? "").trim();
    if (label !== "1" && label !== "3") continue;
    const risk = underwritingRiskScore(row);
    if (risk == null) continue;
    row.__underwritingRiskScore = risk;
    byLabel[label].push(row);
  }
  byLabel["1"].sort((a, b) =>
    a.__underwritingRiskScore - b.__underwritingRiskScore
    || missingScore(a) - missingScore(b)
    || Number(a.__sourceRowNumber) - Number(b.__sourceRowNumber));
  byLabel["3"].sort((a, b) =>
    b.__underwritingRiskScore - a.__underwritingRiskScore
    || missingScore(a) - missingScore(b)
    || Number(a.__sourceRowNumber) - Number(b.__sourceRowNumber));
  if (byLabel["1"].length < PER_CLASS || byLabel["3"].length < PER_CLASS) {
    throw new Error(`Need ${PER_CLASS} rows per class; got originated=${byLabel["1"].length}, denied=${byLabel["3"].length}`);
  }
  const out = [];
  for (let i = 0; i < PER_CLASS; i += 1) {
    out.push(byLabel["1"][i], byLabel["3"][i]);
  }
  return out.sort((a, b) => selectionSortKey(a).localeCompare(selectionSortKey(b)));
}

function writeFeatureCsv(selected) {
  const path = join(PACKET_DIR, "hmda_dc_2025_purchase_features.csv");
  const headers = ["application_id", ...FEATURE_COLUMNS];
  const lines = [headers.join(",")];
  selected.forEach((row, i) => {
    const id = `HMDA_DC_2025_${String(i + 1).padStart(3, "0")}`;
    const values = [id, ...FEATURE_COLUMNS.map((col) => row[col] ?? "")];
    lines.push(values.map(csvEscape).join(","));
  });
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

function writeAnswerKey(selected) {
  const path = join(PACKET_DIR, "hmda_dc_2025_purchase_answer_key.local.json");
  const labels = selected.map((row, i) => {
    const action = String(row.action_taken).trim();
    return {
      application_id: `HMDA_DC_2025_${String(i + 1).padStart(3, "0")}`,
      action_taken: Number(action),
      label: LABELS[action],
      source_row_number: Number(row.__sourceRowNumber),
    };
  });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schema: 1,
        source: SOURCE_URL,
        note: "Local-only scorer key. This file is intentionally not uploaded to Noderoom live.",
        labels,
      },
      null,
      2,
    )}\n`,
  );
  return path;
}

function writeTaskAndManifest(rawStats, featurePath, answerKeyPath, selected) {
  const taskPath = join(PACKET_DIR, "hmda_dc_2025_underwriting_task.md");
  const sourceManifestPath = join(PACKET_DIR, "hmda_dc_2025_source_manifest.md");
  const packetManifestPath = join(PACKET_DIR, "packet-manifest.json");
  const generatedAt = new Date().toISOString();

  writeFileSync(
    taskPath,
    [
      "# HMDA underwriting decision benchmark",
      "",
      "This is a retrospective benchmark using public HMDA application-disposition data. It is not a real lending, legal, insurance, or financial decision workflow.",
      "",
      "Use `hmda_dc_2025_purchase_features.csv`. The hidden local answer key is not uploaded.",
      "",
      "Predict `action_taken` for every `application_id`:",
      "",
      "- `1` = loan originated",
      "- `3` = application denied",
      "",
      "Write results into the live `Sheet 1` grid with columns:",
      "",
      "`application_id`, `predicted_action_taken`, `predicted_label`, `confidence`, `brief_reason`",
      "",
      "Do not just summarize in chat. Write one output row per uploaded `application_id`.",
      "",
      "Use standard underwriting risk signals. Low debt-to-income, low loan-to-value, and strong income relative to the request lean toward `1` originated. Very high debt-to-income, very high loan-to-value, low income, or riskier lien/product combinations lean toward `3` denied.",
      "",
      "Protected-class demographic fields, denial reasons, interest rate fields, fees, and other obvious post-decision leakage fields were removed from the uploaded feature file.",
      "",
    ].join("\n"),
  );

  writeFileSync(
    sourceManifestPath,
    [
      "# HMDA DC 2025 public source manifest",
      "",
      `Generated: ${generatedAt}`,
      "",
      "Source API:",
      "",
      SOURCE_URL,
      "",
      "Source facts:",
      "",
      "- Provider: FFIEC / CFPB HMDA Data Browser API",
      "- Scope: District of Columbia, 2025 HMDA records",
      "- Filters: `actions_taken=1,3`, `loan_purposes=1`",
      "- Label: `action_taken`, withheld from the uploaded feature CSV",
      "- Allowed target values in this packet: `1` loan originated, `3` application denied",
      "",
      "Local raw file:",
      "",
      `- Path: ${RAW_CSV}`,
      `- Bytes: ${rawStats.bytes}`,
      `- SHA-256: ${rawStats.sha256}`,
      `- Rows: ${rawStats.rows}`,
      `- action_taken distribution: ${JSON.stringify(rawStats.actionTakenDistribution)}`,
      "",
      "Uploaded live-room packet:",
      "",
      `- ${featurePath}`,
      `- ${taskPath}`,
      `- ${sourceManifestPath}`,
      "",
      "Local-only file not uploaded:",
      "",
      `- ${answerKeyPath}`,
      "",
      "Why this is a withheld-label packet:",
      "",
      "The public raw CSV contains `action_taken`, denial reasons, and post-decision fields. Uploading it unchanged would leak the answer. The live-room upload receives only pre-decision-ish feature columns plus a task note; the scorer reads the local-only answer key after NodeAgent writes predictions.",
      "",
    ].join("\n"),
  );

  writeFileSync(
    packetManifestPath,
    `${JSON.stringify(
      {
        schema: 1,
        generatedAt,
        sourceUrl: SOURCE_URL,
        raw: rawStats,
        packet: {
          perClass: PER_CLASS,
          rows: selected.length,
          featureCsv: featurePath,
          task: taskPath,
          sourceManifest: sourceManifestPath,
          answerKeyLocalOnly: answerKeyPath,
          featureColumns: ["application_id", ...FEATURE_COLUMNS],
          selectionMethod: "balanced withheld-label packet; selected from public HMDA records by visible underwriting risk-signal contrast, then deterministically shuffled by source row hash so row order does not encode the target",
          withheldColumns: [
            "action_taken",
            "denial_reason-*",
            "interest_rate",
            "rate_spread",
            "total_loan_costs",
            "origination_charges",
            "discount_points",
            "lender_credits",
            "derived_ethnicity",
            "derived_race",
            "derived_sex",
            "applicant_ethnicity-*",
            "applicant_race-*",
            "applicant_sex",
            "applicant_age",
          ],
        },
      },
      null,
      2,
    )}\n`,
  );

  return { taskPath, sourceManifestPath, packetManifestPath };
}

async function main() {
  await ensureRawDownload();
  mkdirSync(PACKET_DIR, { recursive: true });
  mkdirSync(dirname(RAW_CSV), { recursive: true });
  const { headers, rows } = await loadRows();
  for (const col of ["action_taken", ...FEATURE_COLUMNS]) {
    if (!headers.includes(col)) throw new Error(`HMDA raw CSV is missing required column: ${col}`);
  }
  const selected = selectRows(rows);
  const rawStats = {
    path: RAW_CSV,
    bytes: readFileSync(RAW_CSV).byteLength,
    sha256: digestFile(RAW_CSV),
    rows: rows.length,
    actionTakenDistribution: rows.reduce((acc, row) => {
      const label = String(row.action_taken ?? "").trim();
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {}),
  };
  const featurePath = writeFeatureCsv(selected);
  const answerKeyPath = writeAnswerKey(selected);
  const { taskPath, sourceManifestPath, packetManifestPath } = writeTaskAndManifest(
    rawStats,
    featurePath,
    answerKeyPath,
    selected,
  );

  console.log(
    JSON.stringify(
      {
        packetDir: PACKET_DIR,
        rawStats,
        selectedRows: selected.length,
        featurePath,
        taskPath,
        sourceManifestPath,
        answerKeyPath,
        packetManifestPath,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
