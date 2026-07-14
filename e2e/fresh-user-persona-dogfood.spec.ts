import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

const OUTPUT_ROOT = resolve(".proofloop", "proofs", "persona-dogfood");

type PersonaId = "analyst" | "researcher" | "finance-operator" | "founder" | "reviewer" | "guest-observer";

type PersonaConfig = {
  id: PersonaId;
  label: string;
  artifact: string;
  prompt: string;
  completion: RegExp;
  route: string;
  tools: string[];
  exportKind: "xlsx" | "nodegraph-json" | "pptx" | "proof-bundle-json";
  approveConflict?: boolean;
};

type PersonaReceipt = {
  persona: PersonaId;
  label: string;
  environment: "memory-product-path";
  freshLanding: true;
  prompt: string;
  route: string;
  tools: string[];
  agentLatencyMs: number;
  creditsBefore: number;
  creditsAfter: number;
  creditsSpent: number;
  mutation: { before: string; after: string };
  conflict: "approved-through-inline-review" | "rejected-with-host-value-preserved";
  evidence: { traceRecords: number; traceSteps: number };
  export: { kind: PersonaConfig["exportKind"]; fileName: string; bytes: number };
  proofBundle: { fileName: string; integrityHash: string; bytes: number };
  userVisibleSteps: number;
  screenshot: string;
  consoleErrors: string[];
  boundary?: string;
};

const PERSONAS: PersonaConfig[] = [
  {
    id: "analyst",
    label: "Analyst",
    artifact: "Q3 variance",
    prompt: "@nodeagent audit this workbook, repair only verified missing variance cells, and verify every changed cell",
    completion: /passed post-write verification/i,
    route: "scripted/memory-workbook",
    tools: ["inspect_workbook", "verify_workbook", "propose_lock", "edit_cell", "release_lock"],
    exportKind: "xlsx",
  },
  {
    id: "researcher",
    label: "Researcher",
    artifact: "Company research",
    prompt: "@nodeagent diligence ProofNova with source-backed product, buyer, funding, hiring, and security gaps",
    completion: /Researched 1 company/i,
    route: "scripted/memory-research",
    tools: ["propose_lock", "fetch_source", "write_cell_result", "release_lock"],
    exportKind: "nodegraph-json",
  },
  {
    id: "finance-operator",
    label: "Finance operator",
    artifact: "Runway / milestones",
    prompt: "@nodeagent source cash and burn, calculate runway, and preserve milestone gaps for review",
    completion: /Sourced cash \+ burn/i,
    route: "scripted/memory-runway",
    tools: ["propose_lock", "read_range", "edit_cell", "release_lock"],
    exportKind: "xlsx",
  },
  {
    id: "founder",
    label: "Founder",
    artifact: "Capture Notebook",
    prompt: "@nodeagent summarize the Capture Notebook into decisions, risks, and follow-ups with evidence status",
    completion: /Report written under/i,
    route: "scripted/memory-notebook",
    tools: ["read_notebook", "append_notebook_outline"],
    exportKind: "pptx",
  },
  {
    id: "reviewer",
    label: "Reviewer",
    artifact: "Q3 variance",
    prompt: "@nodeagent audit and verify this workbook before review; apply only the smallest deterministic repair",
    completion: /passed post-write verification/i,
    route: "scripted/memory-workbook",
    tools: ["inspect_workbook", "verify_workbook", "propose_lock", "edit_cell", "release_lock"],
    exportKind: "proof-bundle-json",
    approveConflict: true,
  },
  {
    id: "guest-observer",
    label: "Guest observer",
    artifact: "Q3 variance",
    prompt: "/free fill the remaining Q3 variance cells through the recoverable job path",
    completion: /Memory free-auto applied/i,
    route: "scripted/free-auto",
    tools: ["derive_affected_set", "patch_bundle_cas"],
    exportKind: "proof-bundle-json",
  },
];

function publicChat(page: Page): Locator {
  return page.getByTestId("public-chat-panel");
}

async function click(locator: Locator, steps: { value: number }): Promise<void> {
  steps.value += 1;
  await locator.click({ timeout: 10_000 });
}

async function fill(locator: Locator, value: string, steps: { value: number }): Promise<void> {
  steps.value += 1;
  await locator.fill(value);
}

async function enterFreshDemo(context: BrowserContext, persona: PersonaConfig, steps: { value: number }): Promise<Page> {
  await context.addInitScript(() => {
    localStorage.setItem("noderoom:tour:v1", "done");
    localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: false, paused: false }));
  });
  const page = await context.newPage();
  await page.goto("/?mode=memory&surface=desktop", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Work with AI/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("artifact-panel")).toHaveCount(0);
  await click(page.getByTestId("start-demo-room"), steps);
  await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("left-rail")).toBeVisible();
  await openBinderArtifact(page, persona.artifact, steps);
  if (persona.id === "researcher") {
    const panel = page.getByTestId("artifact-panel");
    await click(panel.getByRole("button", { name: "Import accounts" }), steps);
    await fill(panel.getByPlaceholder("Company, website, tier, intent, owner, CRM status"), "ProofNova, https://proofnova.example, A, product diligence, Researcher, Research", steps);
    await click(panel.getByRole("button", { name: "Import / update rows" }), steps);
    await fill(panel.getByRole("textbox", { name: "Search sheet rows" }), "ProofNova", steps);
    await expect(panel.locator('[data-cell-key="rc_proofnova__status"]')).toContainText("pending");
  }
  return page;
}

async function openBinderArtifact(page: Page, title: string, steps: { value: number }): Promise<void> {
  const row = page.getByTestId("left-rail").getByTestId("binder-artifact").filter({ hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await click(row, steps);
}

async function openFileTab(page: Page, title: string, steps: { value: number }): Promise<void> {
  const direct = page.getByTestId("artifact-filetab").filter({ hasText: title }).first();
  if (await direct.count()) {
    await click(direct, steps);
    return;
  }
  await click(page.getByTestId("artifact-tabs").getByLabel("All open tabs"), steps);
  const overflow = page.locator(".r-tab-overflow-menu .r-tab-overflow-item").filter({ hasText: title }).first();
  await expect(overflow).toBeVisible();
  await click(overflow, steps);
}

async function creditBalance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const state = (window as typeof window & { __creditState?: () => { availableCredits?: number } }).__creditState?.();
    return Number(state?.availableCredits ?? 0);
  });
}

async function mutationText(page: Page, persona: PersonaId): Promise<string> {
  if (persona === "researcher") {
    return (await page.locator('[data-cell-key="rc_proofnova__status"]').textContent() ?? "").trim();
  }
  if (persona === "finance-operator") {
    return (await page.locator('[data-cell-key="rw_cardionova__cash"]').textContent() ?? "").trim();
  }
  if (persona === "founder") {
    return (await page.getByTestId("artifact-panel").textContent() ?? "").includes("Report: Notebook summary") ? "report-present" : "report-absent";
  }
  return (await page.locator('[data-cell-key="r_gp__variance"]').textContent() ?? "").trim();
}

async function runNodeAgent(page: Page, persona: PersonaConfig, steps: { value: number }): Promise<number> {
  const chat = publicChat(page);
  const mark = (checkpoint: string) => writeFileSync(
    resolve(OUTPUT_ROOT, `${persona.id}-progress.json`),
    `${JSON.stringify({ persona: persona.id, phase: "nodeagent-task", checkpoint, at: new Date().toISOString() }, null, 2)}\n`,
  );
  const start = Date.now();
  mark("compose");
  await fill(chat.getByTestId("chat-composer"), persona.prompt, steps);
  await click(chat.getByTestId("chat-send"), steps);
  mark("sent");
  if (persona.id === "guest-observer") {
    await expect(chat.getByTestId("job-status")).toContainText("running", { timeout: 10_000 });
    mark("first-attempt-running");
    await click(chat.getByTestId("job-cancel"), steps);
    await expect(chat.getByTestId("job-status")).toContainText("cancelled");
    mark("first-attempt-cancelled");
    await click(chat.getByTestId("job-retry"), steps);
    await expect(chat.getByTestId("job-status")).toContainText("running 2/2");
    mark("second-attempt-running");
  }
  if (persona.id === "researcher") {
    const receipt = chat.getByTestId("agent-research-receipt").filter({ hasText: "ProofNova" }).last();
    await expect(receipt).toBeVisible({ timeout: 30_000 });
    await expect(receipt).toContainText("ProofNova");
  } else {
    await expect(chat.getByText(persona.completion).last()).toBeVisible({ timeout: 30_000 });
  }
  mark("completion-visible");
  await expect(chat.getByTestId("agent-error")).toHaveCount(0);
  mark("complete");
  return Date.now() - start;
}

async function reviewConflict(page: Page, approve: boolean, steps: { value: number }): Promise<PersonaReceipt["conflict"]> {
  await openFileTab(page, "Q3 variance", steps);
  const revenue = page.locator('[data-cell-key="r_rev__variance"]');
  await expect(revenue).toBeVisible();
  await page.evaluate(() => (window as typeof window & { __runConflictDrill?: () => Promise<void> }).__runConflictDrill?.());
  const proposal = revenue.locator('[data-testid="proposal-inline"][data-semantic="true"]');
  await expect(proposal).toBeVisible({ timeout: 15_000 });
  await expect(proposal).toContainText("+19%");
  await expect(revenue).toContainText("+24%");
  if (approve) {
    await click(proposal.getByTestId("proposal-inline-approve"), steps);
    await expect(proposal).toHaveCount(0);
    await expect(revenue).toContainText("+19%");
    return "approved-through-inline-review";
  }
  await click(proposal.getByTestId("proposal-inline-reject"), steps);
  await expect(proposal).toHaveCount(0);
  await expect(revenue).toContainText("+24%");
  return "rejected-with-host-value-preserved";
}

async function reviewTrace(page: Page, steps: { value: number }): Promise<PersonaReceipt["evidence"]> {
  steps.value += 1;
  await page.getByTestId("trace-tab").dispatchEvent("click");
  const trace = page.getByTestId("trace-surface");
  await expect(trace).toBeVisible();
  await expect(page.getByTestId("trace-tab")).toHaveAttribute("data-active", "true");
  const spanRows = trace.getByTestId("trace-span-row");
  if (await spanRows.count()) {
    const traceRecords = Math.max(1, await trace.getByTestId("trace-run-item").count());
    const traceSteps = await spanRows.count();
    await click(spanRows.first(), steps);
    await expect(trace.getByTestId("trace-span-attrs").first()).toBeVisible();
    return { traceRecords, traceSteps };
  }
  await click(trace.getByTestId("trace-view-records"), steps);
  const records = trace.getByTestId("trace-record");
  const traceRecords = await records.count();
  expect(traceRecords).toBeGreaterThan(0);
  await click(records.first(), steps);
  await click(trace.getByTestId("trace-tab-steps"), steps);
  const traceSteps = await trace.getByTestId("trace-step").count();
  expect(traceSteps).toBeGreaterThan(0);
  return { traceRecords, traceSteps };
}

async function saveDownload(page: Page, trigger: () => Promise<void>, path: string): Promise<{ fileName: string; bytes: number }> {
  const pending = page.waitForEvent("download", { timeout: 60_000 });
  await trigger();
  const download = await pending;
  await download.saveAs(path);
  return { fileName: download.suggestedFilename(), bytes: readFileSync(path).byteLength };
}

async function exportPersonaResult(page: Page, persona: PersonaConfig, steps: { value: number }): Promise<PersonaReceipt["export"]> {
  const pathBase = resolve(OUTPUT_ROOT, `${persona.id}-result`);
  if (persona.exportKind === "xlsx") {
    await openFileTab(page, persona.id === "finance-operator" ? "Runway / milestones" : "Q3 variance", steps);
    const result = await saveDownload(page, async () => click(page.getByTestId("artifact-export-xlsx"), steps), `${pathBase}.xlsx`);
    const bytes = readFileSync(`${pathBase}.xlsx`);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    return { kind: persona.exportKind, ...result };
  }
  if (persona.exportKind === "nodegraph-json") {
    steps.value += 1;
    await page.getByTestId("graph-tab").dispatchEvent("click");
    const graph = page.getByTestId("knowledge-graph");
    await expect(graph).toBeVisible();
    await click(graph.getByRole("button", { name: "Show advanced graph controls" }), steps);
    const result = await saveDownload(page, async () => click(graph.getByRole("button", { name: "JSON", exact: true }), steps), `${pathBase}.json`);
    const document = JSON.parse(readFileSync(`${pathBase}.json`, "utf8")) as {
      graph?: { nodes?: Array<{ label?: string }>; edges?: unknown[] };
    };
    expect(document.graph?.nodes?.length ?? 0).toBeGreaterThan(0);
    expect(document.graph?.edges?.length ?? 0).toBeGreaterThan(0);
    expect(document.graph?.nodes?.some((node) => node.label === "ProofNova")).toBe(true);
    return { kind: persona.exportKind, ...result };
  }
  if (persona.exportKind === "pptx") {
    steps.value += 1;
    await page.getByTestId("work-artifacts-tab").dispatchEvent("click");
    const panel = page.getByTestId("work-artifacts-panel");
    await expect(panel).toBeVisible();
    const deckRow = panel.locator('[data-testid="work-artifact-row"][data-kind="deck"]').first();
    await click(deckRow.locator("button").first(), steps);
    const deck = page.getByTestId("deck-storyboard-workbench");
    await expect(deck).toBeVisible();
    const title = deck.getByTestId("deck-collaborative-editor").getByLabel("Title");
    await fill(title, `${await title.inputValue()} - founder review`, steps);
    await click(deck.getByTestId("deck-collaborative-save"), steps);
    await expect(deck.getByTestId("deck-collaboration-status")).toContainText(/Collaborative deck created|Saved collaborative deck/i);
    const result = await saveDownload(page, async () => click(deck.getByTestId("deck-preview-export-pptx"), steps), `${pathBase}.pptx`);
    const bytes = readFileSync(`${pathBase}.pptx`);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    return { kind: persona.exportKind, ...result };
  }
  return exportProofBundle(page, persona, steps).then((receipt) => ({
    kind: persona.exportKind,
    fileName: receipt.fileName,
    bytes: receipt.bytes,
  }));
}

async function exportProofBundle(page: Page, persona: PersonaConfig, steps: { value: number }): Promise<PersonaReceipt["proofBundle"]> {
  steps.value += 1;
  await page.getByTestId("work-artifacts-tab").dispatchEvent("click");
  const panel = page.getByTestId("work-artifacts-panel");
  await expect(panel).toBeVisible();
  const path = resolve(OUTPUT_ROOT, `${persona.id}-proof-bundle.json`);
  const saved = await saveDownload(page, async () => click(panel.getByTestId("proof-bundle-export-json"), steps), path);
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { receipt?: { integrityHash?: string }; integrityHash?: string };
  const integrityHash = String(manifest.receipt?.integrityHash ?? manifest.integrityHash ?? "");
  expect(integrityHash).not.toBe("");
  return { ...saved, integrityHash };
}

async function runPersona(browser: Browser, persona: PersonaConfig): Promise<PersonaReceipt> {
  const context = await browser.newContext({ viewport: { width: 1456, height: 940 }, acceptDownloads: true });
  const consoleErrors: string[] = [];
  const steps = { value: 0 };
  const markPhase = (phase: string) => writeFileSync(
    resolve(OUTPUT_ROOT, `${persona.id}-progress.json`),
    `${JSON.stringify({ persona: persona.id, phase, at: new Date().toISOString() }, null, 2)}\n`,
  );
  try {
    markPhase("fresh-landing");
    const page = await test.step(`${persona.label}: fresh landing`, () => enterFreshDemo(context, persona, steps));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    const before = await mutationText(page, persona.id);
    const creditsBefore = await creditBalance(page);
    markPhase("nodeagent-task");
    const agentLatencyMs = await test.step(`${persona.label}: NodeAgent task`, () => runNodeAgent(page, persona, steps));
    const after = await mutationText(page, persona.id);
    expect(after).not.toBe(before);
    const creditsAfter = await creditBalance(page);
    markPhase("conflict-review");
    const conflict = await test.step(`${persona.label}: conflict review`, () => reviewConflict(page, Boolean(persona.approveConflict), steps));
    markPhase("trace-evidence");
    const evidence = await test.step(`${persona.label}: trace evidence`, () => reviewTrace(page, steps));
    markPhase("domain-export");
    const exported = await test.step(`${persona.label}: domain export`, () => exportPersonaResult(page, persona, steps));
    markPhase("proof-bundle");
    const proofBundle = persona.exportKind === "proof-bundle-json"
      ? { fileName: exported.fileName, bytes: exported.bytes, integrityHash: JSON.parse(readFileSync(resolve(OUTPUT_ROOT, `${persona.id}-proof-bundle.json`), "utf8")).receipt?.integrityHash ?? "unknown" }
      : await test.step(`${persona.label}: proof bundle`, () => exportProofBundle(page, persona, steps));
    const screenshot = resolve(OUTPUT_ROOT, `${persona.id}.png`);
    await page.screenshot({ path: screenshot });
    const unexpectedErrors = consoleErrors.filter((message) => !/ResizeObserver loop|favicon|Download the React DevTools/i.test(message));
    expect(unexpectedErrors).toEqual([]);
    markPhase("complete");
    return {
      persona: persona.id,
      label: persona.label,
      environment: "memory-product-path",
      freshLanding: true,
      prompt: persona.prompt,
      route: persona.route,
      tools: persona.tools,
      agentLatencyMs,
      creditsBefore,
      creditsAfter,
      creditsSpent: Number(Math.max(0, creditsBefore - creditsAfter).toFixed(2)),
      mutation: { before, after },
      conflict,
      evidence,
      export: exported,
      proofBundle,
      userVisibleSteps: steps.value,
      screenshot: screenshot.replaceAll("\\", "/"),
      consoleErrors: unexpectedErrors,
      ...(persona.id === "guest-observer" ? { boundary: "Observer perspective uses the deterministic sample host. Guest role enforcement requires the live multi-user backend and is certified separately." } : {}),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

test("six fresh-user personas complete NodeAgent, conflict, evidence, and export workflows", async ({ browser }) => {
  test.setTimeout(360_000);
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  const requestedPersona = process.env.NODEROOM_PERSONA?.trim();
  const personas = requestedPersona ? PERSONAS.filter((persona) => persona.id === requestedPersona) : PERSONAS;
  if (requestedPersona && personas.length === 0) throw new Error(`Unknown NODEROOM_PERSONA: ${requestedPersona}`);
  const receipts: PersonaReceipt[] = [];
  for (const persona of personas) receipts.push(await test.step(persona.label, () => runPersona(browser, persona)));
  expect(receipts).toHaveLength(personas.length);
  expect(receipts.every((receipt) => receipt.freshLanding && receipt.mutation.before !== receipt.mutation.after)).toBe(true);
  expect(receipts.every((receipt) => receipt.evidence.traceRecords > 0 && receipt.evidence.traceSteps > 0)).toBe(true);
  expect(receipts.every((receipt) => receipt.export.bytes > 0 && receipt.proofBundle.integrityHash.length > 0)).toBe(true);
  const aggregate = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: "deterministic memory-mode product path",
    liveCoverageReference: "docs/eval/noderoom-fresh-user-vertical-proof.json",
    personas: receipts,
    gates: {
      freshLanding: "passed",
      nodeAgent: "passed",
      mutation: "passed",
      conflictHandling: "passed",
      evidenceReview: "passed",
      export: "passed",
      consoleErrors: 0,
    },
  };
  writeFileSync(resolve(OUTPUT_ROOT, "persona-dogfood-receipt.json"), `${JSON.stringify(aggregate, null, 2)}\n`);
});
