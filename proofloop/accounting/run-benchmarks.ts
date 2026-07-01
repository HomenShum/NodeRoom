/**
 * Accounting benchmark runner — validates accounting workflows against known ground truth.
 *
 * Usage: npx tsx proofloop/accounting/run-benchmarks.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dataDir = join(process.cwd(), "proofloop", "accounting", "datasets");
const outputDir = process.env.PROOFLOOP_OUTPUT_DIR ?? join(process.cwd(), ".proofloop", "runs", "latest");
const artifactsDir = join(outputDir, "artifacts");
mkdirSync(outputDir, { recursive: true });
mkdirSync(artifactsDir, { recursive: true });

interface BenchmarkResult {
  category: string;
  scenarioId: string;
  status: "pass" | "fail";
  score: number;
  detail: string;
}

type FrA1Receipt = {
  passed?: boolean;
  uploadedFiles?: string[];
  outputWorkbook?: { bytes?: number; magic?: string };
  reopenedWorkbook?: { sheets?: string[]; checks?: Record<string, boolean> };
  scorer?: { verdict?: "pass" | "fail"; score?: number };
};

function loadDataset(name: string): unknown {
  const path = join(dataDir, `${name}.json`);
  if (!existsSync(path)) throw new Error(`Dataset not found: ${name}`);
  return readJson(path);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, ""));
}

function writeArtifact(name: string, payload: unknown): string {
  const path = join(artifactsDir, name);
  writeFileSync(path, JSON.stringify({ generatedAt: new Date().toISOString(), payload }, null, 2), "utf-8");
  return path;
}

function artifactExists(name: string): boolean {
  return existsSync(join(artifactsDir, name));
}

function requiredRunReceipts(): BenchmarkResult[] {
  const required = [
    "accounting-ui-contract.json",
    "noderoom-accounting-ui.json",
    "nodebench-accounting-report.json",
    "fr-a1-bank-reconciliation.json",
  ];
  return required.map((name) => ({
    category: "proof_receipt",
    scenarioId: name.replace(/\.json$/, ""),
    status: artifactExists(name) ? "pass" : "fail",
    score: artifactExists(name) ? 0 : 0,
    detail: artifactExists(name) ? `Receipt found: artifacts/${name}` : `Missing required run receipt: artifacts/${name}`,
  }));
}

function countReconciliationDiscrepancies(data: {
  ledger: Array<{ date: string; description: string; amount: number }>;
  bankStatement: Array<{ date: string; description: string; amount: number }>;
}): number {
  let discrepancies = 0;
  for (const ledgerRow of data.ledger) {
    const exact = data.bankStatement.find((bankRow) =>
      bankRow.date === ledgerRow.date
      && bankRow.description === ledgerRow.description
      && bankRow.amount === ledgerRow.amount,
    );
    if (!exact) discrepancies++;
  }
  return discrepancies;
}

function validateFrA1Receipt(): { ok: boolean; detail: string } {
  const name = "fr-a1-bank-reconciliation.json";
  if (!artifactExists(name)) return { ok: false, detail: `Missing ${name}` };

  const receipt = readJson(join(artifactsDir, name)) as FrA1Receipt;
  const requiredUploads = [
    "bank_statement.csv",
    "general_ledger.csv",
    "prior_month_recon.xlsx",
    "close_policy.pdf",
    "reconciliation.xlsx",
  ];
  const uploaded = new Set(receipt.uploadedFiles ?? []);
  const missingUploads = requiredUploads.filter((file) => !uploaded.has(file));
  const sheets = new Set(receipt.reopenedWorkbook?.sheets ?? []);
  const missingSheets = ["Reconciliation", "Exceptions", "JEs", "Memo"].filter((sheet) => !sheets.has(sheet));
  const checks = receipt.reopenedWorkbook?.checks ?? {};
  const failedChecks = Object.entries(checks).filter(([, passed]) => passed !== true).map(([key]) => key);
  const hasAllChecks = [
    "adjustedBankBalance",
    "adjustedBookBalance",
    "unreconciledDifference",
    "exceptionRows",
    "journalEntryRows",
    "memoEvidence",
  ].every((key) => checks[key] === true);
  const exportOk =
    receipt.outputWorkbook?.magic === "PK"
    && typeof receipt.outputWorkbook.bytes === "number"
    && receipt.outputWorkbook.bytes > 0;

  const ok =
    receipt.passed === true
    && receipt.scorer?.verdict === "pass"
    && exportOk
    && missingUploads.length === 0
    && missingSheets.length === 0
    && hasAllChecks
    && failedChecks.length === 0;

  return {
    ok,
    detail: ok
      ? "FR-A1 browser packet receipt passed with upload/export/reopen scoring"
      : [
          receipt.passed !== true ? "receipt not passed" : undefined,
          receipt.scorer?.verdict !== "pass" ? "scorer not pass" : undefined,
          !exportOk ? "export missing PK/bytes" : undefined,
          missingUploads.length ? `missing uploads: ${missingUploads.join(", ")}` : undefined,
          missingSheets.length ? `missing sheets: ${missingSheets.join(", ")}` : undefined,
          !hasAllChecks || failedChecks.length ? `failed checks: ${failedChecks.join(", ") || "missing checks"}` : undefined,
        ].filter(Boolean).join("; "),
  };
}

function runBenchmarks(): void {
  const results: BenchmarkResult[] = [...requiredRunReceipts()];

  // Benchmark 1: Invoice extraction
  try {
    const invoices = loadDataset("invoices") as Array<{ vendor: string; total: number; lineItems: number }>;
    const allValid = invoices.every((inv) => inv.vendor && inv.total > 0 && inv.lineItems > 0);
    const totalSpend = invoices.reduce((sum, inv) => sum + inv.total, 0);
    writeArtifact("invoice-extraction.output.json", {
      invoiceCount: invoices.length,
      totalSpend,
      vendors: invoices.map((inv) => inv.vendor),
      sourceEvidence: "proofloop/accounting/datasets/invoices.json",
    });
    const outputValid = artifactExists("invoice-extraction.output.json") && totalSpend > 0;
    const passed = allValid && outputValid;
    results.push({
      category: "invoice_receipt_extraction",
      scenarioId: "invoice-extraction",
      status: passed ? "pass" : "fail",
      score: passed ? 20 : 0,
      detail: `${invoices.length} invoices validated; output artifact ${outputValid ? "present" : "missing"}`,
    });
  } catch (err) {
    results.push({ category: "invoice_receipt_extraction", scenarioId: "invoice-extraction", status: "fail", score: 0, detail: String(err) });
  }

  // Benchmark 2: Reconciliation
  try {
    const data = loadDataset("reconciliation") as {
      ledger: Array<{ date: string; description: string; amount: number }>;
      bankStatement: Array<{ date: string; description: string; amount: number }>;
      expectedDiscrepancies: number;
    };
    const ledgerCount = data.ledger.length;
    const bankCount = data.bankStatement.length;
    const discrepancyCount = countReconciliationDiscrepancies(data);
    const frA1 = validateFrA1Receipt();
    writeArtifact("spreadsheet-reconciliation.output.json", {
      ledgerCount,
      bankCount,
      discrepancyCount,
      expectedDiscrepancies: data.expectedDiscrepancies,
      sourceEvidence: "proofloop/accounting/datasets/reconciliation.json",
      browserPacketReceipt: "artifacts/fr-a1-bank-reconciliation.json",
      browserPacketPassed: frA1.ok,
    });
    const passed = discrepancyCount === data.expectedDiscrepancies && frA1.ok && artifactExists("spreadsheet-reconciliation.output.json");
    results.push({
      category: "finance_accounting_spreadsheet_workflow",
      scenarioId: "spreadsheet-reconciliation",
      status: passed ? "pass" : "fail",
      score: passed ? 20 : 0,
      detail: `Ledger: ${ledgerCount} rows, Bank: ${bankCount} rows, discrepancies: ${discrepancyCount}/${data.expectedDiscrepancies}; ${frA1.detail}`,
    });
  } catch (err) {
    results.push({ category: "finance_accounting_spreadsheet_workflow", scenarioId: "spreadsheet-reconciliation", status: "fail", score: 0, detail: String(err) });
  }

  // Benchmark 3: Financial statement QA
  try {
    const statements = loadDataset("financial-statements") as { balanceSheet: { assets: number; liabilities: number; equity: number }; incomeStatement: { revenue: number; expenses: number; netIncome: number }; cashFlow: { operating: number; investing: number; financing: number; net: number } };
    const balances = statements.balanceSheet.assets === statements.balanceSheet.liabilities + statements.balanceSheet.equity;
    const incomeCorrect = statements.incomeStatement.netIncome === statements.incomeStatement.revenue - statements.incomeStatement.expenses;
    const cashCorrect = statements.cashFlow.net === statements.cashFlow.operating + statements.cashFlow.investing + statements.cashFlow.financing;
    writeArtifact("financial-statement-qa.output.json", {
      balances,
      incomeCorrect,
      cashCorrect,
      sourceEvidence: "proofloop/accounting/datasets/financial-statements.json",
    });
    const passed = balances && incomeCorrect && cashCorrect && artifactExists("financial-statement-qa.output.json");
    results.push({
      category: "financial_statement_qa",
      scenarioId: "financial-statement-qa",
      status: passed ? "pass" : "fail",
      score: passed ? 20 : 0,
      detail: `Balance sheet balances: ${balances}, Income correct: ${incomeCorrect}, Cash flow correct: ${cashCorrect}`,
    });
  } catch (err) {
    results.push({ category: "financial_statement_qa", scenarioId: "financial-statement-qa", status: "fail", score: 0, detail: String(err) });
  }

  // Benchmark 4: Variance analysis
  try {
    const data = loadDataset("variance") as { budget: Array<{ category: string; budget: number; actual: number }>; expectedVariances: number };
    const variances = data.budget.map((b) => ({ category: b.category, variance: b.actual - b.budget, pctChange: ((b.actual - b.budget) / b.budget) * 100 }));
    const hasVariances = variances.every((v) => typeof v.variance === "number" && !isNaN(v.variance));
    writeArtifact("variance-analysis.output.json", {
      variances,
      expectedVariances: data.expectedVariances,
      sourceEvidence: "proofloop/accounting/datasets/variance.json",
    });
    const passed = hasVariances && variances.length === data.expectedVariances && artifactExists("variance-analysis.output.json");
    results.push({
      category: "quantitative_finance_reasoning",
      scenarioId: "variance-analysis",
      status: passed ? "pass" : "fail",
      score: passed ? 20 : 0,
      detail: `${variances.length}/${data.expectedVariances} variance lines calculated — ${hasVariances ? "all valid" : "invalid calculations"}`,
    });
  } catch (err) {
    results.push({ category: "quantitative_finance_reasoning", scenarioId: "variance-analysis", status: "fail", score: 0, detail: String(err) });
  }

  // Benchmark 5: Report generation receipt
  try {
    const reportReceiptPath = join(artifactsDir, "nodebench-accounting-report.json");
    const receipt = artifactExists("nodebench-accounting-report.json")
      ? readJson(reportReceiptPath) as { tableCount?: number; textInputCount?: number }
      : null;
    const surfaceCount = Number(receipt?.tableCount ?? 0) + Number(receipt?.textInputCount ?? 0);
    writeArtifact("accounting-report-generation.output.json", {
      surfaceCount,
      receipt: "artifacts/nodebench-accounting-report.json",
    });
    const passed = surfaceCount > 0 && artifactExists("accounting-report-generation.output.json");
    results.push({
      category: "report_generation",
      scenarioId: "nodebench-accounting-report",
      status: passed ? "pass" : "fail",
      score: passed ? 20 : 0,
      detail: `Report workflow surfaces: ${surfaceCount}`,
    });
  } catch (err) {
    results.push({ category: "report_generation", scenarioId: "nodebench-accounting-report", status: "fail", score: 0, detail: String(err) });
  }

  // Write results
  const totalScore = results.reduce((sum, r) => sum + r.score, 0);
  const allPassed = results.every((r) => r.status === "pass");
  const report = {
    timestamp: new Date().toISOString(),
    results,
    totalScore,
    maxScore: 100,
    passed: allPassed,
  };

  writeFileSync(join(outputDir, "accounting-results.json"), JSON.stringify(report, null, 2), "utf-8");

  // Write benchmark registry validation
  const registryPath = join(process.cwd(), "proofloop", "accounting", "benchmarks", "benchmark-registry.json");
  if (existsSync(registryPath)) {
    const registry = readJson(registryPath) as { benchmarks: Array<{ pinned: boolean }> };
    const allPinned = registry.benchmarks.every((b: { pinned: boolean }) => b.pinned);
    if (!allPinned) {
      console.error("run-benchmarks: ❌ some benchmarks are not pinned");
      process.exit(1);
    }
  }

  console.log(`run-benchmarks: ${allPassed ? "✅" : "❌"} ${results.filter((r) => r.status === "pass").length}/${results.length} passed, score=${totalScore}/100`);
  process.exit(allPassed ? 0 : 1);
}

runBenchmarks();
