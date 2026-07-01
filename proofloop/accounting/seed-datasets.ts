/**
 * Seed accounting datasets — loads fixture data into the proof-loop data directory.
 *
 * Usage: npx tsx proofloop/accounting/seed-datasets.ts
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const dataDir = join(process.cwd(), "proofloop", "accounting", "datasets");
const FIXTURE_GENERATED_AT = "2026-07-01T00:00:00.000Z";
mkdirSync(dataDir, { recursive: true });

interface DatasetEntry {
  name: string;
  source: string;
  task: string;
  license_checked: boolean;
  checksum: string;
  description: string;
}

function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// Sample invoice data
const invoices = [
  { id: "inv-001", vendor: "ACME Supplies", total: 1250.00, lineItems: 3, date: "2026-06-15" },
  { id: "inv-002", vendor: "TechCorp", total: 4800.50, lineItems: 7, date: "2026-06-20" },
  { id: "inv-003", vendor: "Office Depot", total: 312.75, lineItems: 2, date: "2026-06-25" },
];

// Reconciliation data
const ledger = [
  { id: "l-001", date: "2026-06-01", description: "Client payment", amount: 5000.00 },
  { id: "l-002", date: "2026-06-05", description: "Office rent", amount: -2000.00 },
  { id: "l-003", date: "2026-06-10", description: "Software subscription", amount: -99.00 },
];
const bankStatement = [
  { id: "b-001", date: "2026-06-01", description: "Client payment", amount: 5000.00 },
  { id: "b-002", date: "2026-06-05", description: "Office rent", amount: -2000.00 },
  { id: "b-003", date: "2026-06-12", description: "Software subscription", amount: -99.00 },
];

// Financial statements
const balanceSheet = { assets: 150000, liabilities: 45000, equity: 105000 };
const incomeStatement = { revenue: 320000, expenses: 210000, netIncome: 110000 };
const cashFlow = { operating: 95000, investing: -30000, financing: -15000, net: 50000 };

// Variance data
const budget = [
  { category: "Revenue", budget: 300000, actual: 320000 },
  { category: "COGS", budget: 120000, actual: 135000 },
  { category: "Marketing", budget: 50000, actual: 38000 },
  { category: "Engineering", budget: 80000, actual: 92000 },
];

// Write datasets
const datasets: DatasetEntry[] = [];

const invoicesJson = JSON.stringify(invoices, null, 2);
writeFileSync(join(dataDir, "invoices.json"), invoicesJson, "utf-8");
datasets.push({ name: "invoices", source: "local-fixture", task: "invoice_extraction", license_checked: true, checksum: checksum(invoicesJson), description: "3 sample invoices with known ground truth" });

const reconciliationJson = JSON.stringify({ ledger, bankStatement, expectedDiscrepancies: 1 }, null, 2);
writeFileSync(join(dataDir, "reconciliation.json"), reconciliationJson, "utf-8");
datasets.push({ name: "reconciliation", source: "local-fixture", task: "reconciliation", license_checked: true, checksum: checksum(reconciliationJson), description: "Ledger vs bank statement with 1 known discrepancy" });

const statementsJson = JSON.stringify({ balanceSheet, incomeStatement, cashFlow }, null, 2);
writeFileSync(join(dataDir, "financial-statements.json"), statementsJson, "utf-8");
datasets.push({ name: "financial-statements", source: "local-fixture", task: "statement_qa", license_checked: true, checksum: checksum(statementsJson), description: "Balance sheet, income statement, cash flow" });

const varianceJson = JSON.stringify({ budget, expectedVariances: 4 }, null, 2);
writeFileSync(join(dataDir, "variance.json"), varianceJson, "utf-8");
datasets.push({ name: "variance", source: "local-fixture", task: "variance_analysis", license_checked: true, checksum: checksum(varianceJson), description: "Budget vs actuals with 4 categories" });

// Write dataset registry
const registry = { datasets, generatedAt: FIXTURE_GENERATED_AT };
writeFileSync(join(dataDir, "dataset-registry.json"), JSON.stringify(registry, null, 2), "utf-8");

console.log(`seed-datasets: ✅ ${datasets.length} accounting datasets seeded`);
console.log(`seed-datasets: registry at ${join(dataDir, "dataset-registry.json")}`);
