import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { enableFocusModeForTest, expectAttentionOverlayMounted, expectFocusModeOn } from "../../e2e/focusMode";

export const PROXIMITTY_SUITE = "proximitty-underwriting-pr0";

export type WorkspaceProof = {
  baseUrl: string;
  roomUrl: string;
  mode: "live" | "memory";
  pageErrors: string[];
  consoleErrors: string[];
};

export type EvidenceClaim = {
  claim: string;
  evidenceRef?: string;
  status: "supported" | "needs_review";
};

export type AgentInvocationProof = {
  prompt: string;
  chatMessageVisible: boolean;
  thinkingVisible: boolean;
  jobStatusVisible: boolean;
  streamVisible: boolean;
  streamPartVisible: boolean;
  agentErrorCount: number;
};

const datasetRoot = resolve(process.cwd(), "proofloop", "datasets", "proximitty-demo-underwriting");

export const demoInputFiles = [
  join(datasetRoot, "company-profile.json"),
  join(datasetRoot, "underwriting-policy.md"),
  join(datasetRoot, "synthetic-financials.csv"),
  join(datasetRoot, "risk-notes.md"),
  join(datasetRoot, "source-pack.md"),
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function binderTitlePattern(filename: string): RegExp {
  const extension = filename.match(/\.(json|md|csv)$/i)?.[1]?.toUpperCase() ?? "";
  const stem = filename.replace(/\.(json|md|csv)$/i, "").replace(/[-_]+/g, " ");
  const title = extension ? `${stem} ${extension}` : stem;
  return new RegExp(escapeRegex(title), "i");
}

export function outputDir(): string {
  return process.env.PROOFLOOP_OUTPUT_DIR ?? join(process.cwd(), ".proofloop", "runs", "latest");
}

export function artifactPath(name: string): string {
  const dir = join(outputDir(), "artifacts");
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

export function screenshotPath(name: string): string {
  const dir = join(outputDir(), "screenshots");
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

export function writeJsonArtifact(name: string, payload: Record<string, unknown>): string {
  const path = artifactPath(name);
  writeFileSync(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...payload }, null, 2)}\n`, "utf-8");
  return path;
}

export function appendCockpitEvent(type: string, message: string, metadata: Record<string, unknown> = {}): void {
  const path = join(outputDir(), "cockpit-events.jsonl");
  mkdirSync(outputDir(), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), type, message, metadata })}\n`, "utf-8");
}

export function readDataset(name: string): string {
  return readFileSync(join(datasetRoot, name), "utf-8");
}

export function parseFinancials(): Array<Record<string, string>> {
  const csv = readDataset("synthetic-financials.csv").trim().split(/\r?\n/);
  const headers = csv[0].split(",");
  return csv.slice(1).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

export function buildEvidenceClaims(): EvidenceClaim[] {
  const rows = parseFinancials();
  const latest = rows[rows.length - 1];
  const prior = rows[rows.length - 2];
  const revenueGrowth = ((Number(latest.revenue_usd) - Number(prior.revenue_usd)) / Number(prior.revenue_usd)) * 100;
  const dscr = Number(latest.ebitda_usd) / Number(latest.debt_service_usd);
  return [
    {
      claim: `Revenue grew ${revenueGrowth.toFixed(1)} percent from 2024 to 2025.`,
      evidenceRef: "synthetic-financials.csv:2024-2025",
      status: "supported",
    },
    {
      claim: `Debt-service coverage is ${dscr.toFixed(2)}x based on 2025 EBITDA and debt service.`,
      evidenceRef: "synthetic-financials.csv:2025",
      status: "supported",
    },
    {
      claim: `Top customer concentration is ${latest.top_customer_pct} percent and must be treated as a key risk.`,
      evidenceRef: "risk-notes.md:customer-concentration",
      status: "supported",
    },
    {
      claim: "UCC and lien confirmation are not included in the demo packet.",
      evidenceRef: "risk-notes.md:ucc-confirmation",
      status: "needs_review",
    },
    {
      claim: "Insurance certificate renewal is due soon and should be confirmed before any real transaction.",
      evidenceRef: "risk-notes.md:insurance-renewal",
      status: "needs_review",
    },
  ];
}

export function buildUnderwritingPacket(): string {
  const claims = buildEvidenceClaims();
  const supported = claims.filter((claim) => claim.status === "supported");
  const needsReview = claims.filter((claim) => claim.status === "needs_review");
  const rows = parseFinancials();
  const latest = rows[rows.length - 1];
  const ebitdaMargin = (Number(latest.ebitda_usd) / Number(latest.revenue_usd)) * 100;
  const dscr = Number(latest.ebitda_usd) / Number(latest.debt_service_usd);
  return [
    "# Proximitty-Style Underwriting Packet",
    "",
    "> Evaluation output only. This is synthetic demo data and is not a real underwriting, lending, legal, or insurance decision.",
    "",
    "## Summary",
    "",
    "HarborPoint Robotics requests a synthetic 3.5M USD senior secured working-capital line for inventory and deployment milestone bridging.",
    "",
    "## Key Risks",
    "",
    "- Customer concentration is above the policy threshold and should be diligence priority one. Evidence: risk-notes.md:customer-concentration.",
    "- Deployment milestones slipped by 45 days, creating timing risk. Evidence: risk-notes.md:deployment-slip.",
    "- UCC/lien confirmation and insurance renewal are unresolved and remain needs_review.",
    "",
    "## Mitigants",
    "",
    "- Revenue and EBITDA expanded across the uploaded period. Evidence: synthetic-financials.csv:2023-2025.",
    "- Eligible AR and inventory provide a synthetic collateral base. Evidence: company-profile.json:collateral.",
    "- Facility purpose is tied to purchase orders and deployment milestones, but purchase orders are not included and must remain needs_review.",
    "",
    "## Financial/Risk Signals",
    "",
    `- 2025 revenue: ${latest.revenue_usd} USD. Evidence: synthetic-financials.csv:2025.`,
    `- 2025 EBITDA margin: ${ebitdaMargin.toFixed(1)} percent. Evidence: synthetic-financials.csv:2025.`,
    `- Debt-service coverage: ${dscr.toFixed(2)}x. Evidence: synthetic-financials.csv:2025.`,
    `- Top customer concentration: ${latest.top_customer_pct} percent. Evidence: risk-notes.md:customer-concentration.`,
    "",
    "## Evidence Links",
    "",
    ...supported.map((claim) => `- ${claim.claim} Evidence: ${claim.evidenceRef}.`),
    "",
    "## Needs_Review Items",
    "",
    ...needsReview.map((claim) => `- ${claim.claim} Evidence: ${claim.evidenceRef}.`),
    "",
    "## Next Action Recommendation",
    "",
    "Proceed only to a human underwriting review packet check. Do not approve, decline, bind, lend, insure, or price anything from this demo output.",
    "",
  ].join("\n");
}

export async function openFreshWorkspace(page: Page): Promise<WorkspaceProof> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error.message ?? error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await enableFocusModeForTest(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("noderoom:tour:v1", "done");
      localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: true, paused: false }));
      localStorage.setItem("noderoom.nodeagentRuntimeProfile", "benchmark_completion");
    } catch {
      // ignored in sandboxed browser contexts
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("create-room")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("create-room").click();
  const displayName = page.getByTestId("create-display-name");
  if (await displayName.isVisible().catch(() => false)) {
    await displayName.fill("Proximitty Demo");
  }
  await page.getByTestId("create-room-submit").click();
  const blankSheet = page.getByTestId("blank-cta-sheet");
  const addBlankSheet = page.getByRole("button", { name: /Add a blank sheet/i });
  const sheetCtaClicked = await clickWhenVisible(blankSheet, 60_000) || await clickWhenVisible(addBlankSheet, 60_000);
  expect(sheetCtaClicked, "fresh room must expose a blank sheet CTA").toBe(true);
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 45_000 });
  await expectFocusModeOn(page);
  await ensureBinderOpen(page);
  const sheetArtifact = page.getByTestId("binder-artifact").filter({ hasText: /Sheet 1|Sheet/i }).first();
  if (await sheetArtifact.isVisible().catch(() => false)) {
    await sheetArtifact.click({ timeout: 30_000 });
  }
  await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 45_000 });
  await expectAttentionOverlayMounted(page);
  await expect(page.getByTestId("public-chat-panel").getByTestId("chat-composer")).toBeVisible({ timeout: 45_000 });
  const roomUrl = page.url();
  expect(roomUrl, "Proximitty proof must use live/staging UI, not memory mode").not.toContain("mode=memory");
  return {
    baseUrl: new URL(roomUrl).origin,
    roomUrl,
    mode: "live",
    pageErrors,
    consoleErrors,
  };
}

export async function ensureBinderOpen(page: Page): Promise<void> {
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click({ timeout: 30_000 });
  }
  await expect(leftRail).toBeVisible({ timeout: 30_000 });
}

async function clickWhenVisible(locator: Locator, timeout: number): Promise<boolean> {
  const visible = await locator.waitFor({ state: "visible", timeout }).then(() => true, () => false);
  if (!visible) return false;
  await locator.click({ timeout });
  return true;
}

async function waitForVisible(locator: Locator, timeout: number): Promise<boolean> {
  return expect(locator.first()).toBeVisible({ timeout }).then(() => true, () => false);
}

export async function uploadDemoInputs(page: Page): Promise<string[]> {
  for (const file of demoInputFiles) {
    expect(existsSync(file), `demo input exists: ${file}`).toBe(true);
  }
  await ensureBinderOpen(page);
  const input = page.locator(".r-file-input");
  await input.waitFor({ state: "attached", timeout: 30_000 });
  await input.setInputFiles(demoInputFiles);
  const uploaded: string[] = [];
  for (const file of demoInputFiles) {
    const name = basename(file);
    const titlePattern = binderTitlePattern(name);
    const artifactRow = page.getByTestId("binder-artifact").filter({ hasText: titlePattern })
      .or(page.getByRole("button", { name: titlePattern }));
    await expect(artifactRow.first()).toBeVisible({ timeout: 45_000 });
    uploaded.push(name);
  }
  appendCockpitEvent("gate_pass", "benchmark inputs uploaded through UI", { uploaded });
  return uploaded;
}

export async function invokeVisibleAgent(page: Page, goal: string): Promise<AgentInvocationProof> {
  const chat = page.getByTestId("public-chat-panel");
  const composer = chat.getByTestId("chat-composer");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(goal);
  await expect(chat.getByTestId("chat-send")).toBeEnabled({ timeout: 10_000 });
  await chat.getByTestId("chat-send").click();
  appendCockpitEvent("agent_status", "public visible-agent prompt sent", { goal: goal.slice(0, 240) });

  await expect(chat.getByTestId("chat-message").filter({ hasText: goal })).toBeVisible({ timeout: 15_000 });
  const thinkingVisible = await waitForVisible(chat.getByText(/thinking/i), 15_000);
  const jobStatusVisible = await expect(chat.getByTestId("job-status").first())
    .toContainText(/queued|running|completed|blocked|failed/i, { timeout: 15_000 })
    .then(() => true, () => false);
  const stream = chat.getByTestId("agent-unified-stream").first();
  const streamVisible = await waitForVisible(stream, 15_000);
  const streamPartVisible = streamVisible
    ? await waitForVisible(stream.locator('[data-part="step"], [data-part="tool"], [data-testid="agent-stream-text"]'), 15_000)
    : false;
  const agentErrorCount = await chat.getByTestId("agent-error").count();
  const proof = {
    prompt: goal,
    chatMessageVisible: true,
    thinkingVisible,
    jobStatusVisible,
    streamVisible,
    streamPartVisible,
    agentErrorCount,
  };
  appendCockpitEvent(thinkingVisible || jobStatusVisible || streamVisible ? "gate_pass" : "gate_fail", "agent invocation visible", proof);
  return proof;
}

export async function captureScenarioScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<string> {
  const path = screenshotPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, { path, contentType: "image/png" });
  appendCockpitEvent("gate_pass", "visual browser proof captured", { screenshot: path });
  return path;
}

export function assertNoUnexpectedErrors(proof: WorkspaceProof): void {
  const allowed = /ResizeObserver|favicon|storage/i;
  expect(proof.pageErrors.filter((item) => !allowed.test(item))).toEqual([]);
  expect(proof.consoleErrors.filter((item) => !allowed.test(item))).toEqual([]);
}
