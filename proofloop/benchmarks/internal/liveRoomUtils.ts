import { expect, type Locator, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { providerForAgentModelPolicy, withNodeAgentMention } from "../../../src/eval/proofloopLiveBrowserPrompt";
import {
  evaluateProofloopRouteIntegrity,
  routeIntegrityFailureSummary,
  type ProofloopRouteIntegrity,
} from "../../../src/eval/proofloopRouteIntegrity";
import { noderoomSelectors } from "../../adapters/noderoom/selectors";

export type BrowserProblem = {
  type: string;
  text?: string;
  url?: string;
  status?: number;
};

export type BrowserProblemRecorder = {
  pageErrors: BrowserProblem[];
  consoleProblems: BrowserProblem[];
  requestFailures: BrowserProblem[];
  badResponses: BrowserProblem[];
};

export type LiveRunTelemetry = {
  model: string;
  toolCalls: number | null;
  steps: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  rawText: string;
  rawTitle: string;
};

export type InternalNodeAgentProof = {
  userMessageVisible: boolean;
  streamingVisible: boolean;
  jobStatusVisible: boolean;
  jobDetailVisible: boolean;
  roomTraceVisible: boolean;
  completionVisible: boolean;
  finalTextSample: string;
  durationMs: number;
  telemetry: LiveRunTelemetry | null;
  gatesProven: string[];
  gatesNotProven: Record<string, string>;
};

export type InternalLiveRoomOptions = {
  baseUrl: string;
  agentModelMode: string;
  agentModelPolicy: string;
  runtimeProfile: string;
  agentTimeoutMs: number;
  streamTimeoutMs: number;
  requireCompletionPhrase?: boolean;
};

export function recordBrowserProblems(page: Page): BrowserProblemRecorder {
  const recorder: BrowserProblemRecorder = {
    pageErrors: [],
    consoleProblems: [],
    requestFailures: [],
    badResponses: [],
  };
  page.on("pageerror", (error) => recorder.pageErrors.push({ type: "pageerror", text: error.message }));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      recorder.consoleProblems.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("requestfailed", (request) => {
    recorder.requestFailures.push({ type: "requestfailed", url: request.url(), text: request.failure()?.errorText ?? "unknown" });
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !/favicon|sockjs-node|webpack-hmr/i.test(response.url())) {
      recorder.badResponses.push({ type: "response", url: response.url(), status: response.status() });
    }
  });
  return recorder;
}

export function problemCounts(recorder: BrowserProblemRecorder): Record<string, number> {
  return {
    pageErrors: recorder.pageErrors.length,
    consoleProblems: recorder.consoleProblems.length,
    requestFailures: recorder.requestFailures.length,
    badResponses: recorder.badResponses.length,
  };
}

export async function installRuntimeProfile(page: Page, runtimeProfile: string): Promise<void> {
  await page.addInitScript((profile) => {
    try {
      if (profile) window.localStorage?.setItem("noderoom.nodeagentRuntimeProfile", profile);
      else window.localStorage?.removeItem("noderoom.nodeagentRuntimeProfile");
      window.localStorage?.setItem("noderoom:tour:v1", "done");
    } catch {
      // Browser storage can be unavailable in sandboxed preview frames.
    }
  }, runtimeProfile);
}

export async function createFreshLiveRoom(page: Page, options: {
  baseUrl: string;
  displayName?: string;
  roomCode?: string;
  demoSeed?: boolean;
}): Promise<string> {
  const code = options.roomCode;
  const name = encodeURIComponent(options.displayName ?? "Proof Loop");
  const target = code
    ? `${options.baseUrl}/?${options.demoSeed ? "demo" : "room"}=${encodeURIComponent(code)}&name=${name}`
    : `${options.baseUrl}/`;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
  expect(page.url(), "internal live proof must not use memory mode").not.toContain("mode=memory");
  if (code) {
    await expect(page.getByTestId("public-chat-panel").getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
    return page.url();
  }

  await page.getByTestId("create-room").click({ timeout: 60_000 });
  const displayName = page.getByTestId("create-display-name");
  if (await displayName.isVisible().catch(() => false)) {
    await displayName.fill(options.displayName ?? "Proof Loop");
  }
  await page.getByTestId("create-room-submit").click({ timeout: 30_000 });
  const blankSheet = page.getByTestId("blank-cta-sheet");
  const addBlankSheet = page.getByRole("button", { name: /Add a blank sheet/i });
  const clicked = await clickWhenVisible(blankSheet, 60_000) || await clickWhenVisible(addBlankSheet, 60_000);
  expect(clicked, "fresh room must expose a blank sheet CTA").toBe(true);
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 45_000 });
  return page.url();
}

export async function ensureBinderOpen(page: Page): Promise<void> {
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click({ timeout: 30_000 });
  }
  await expect(leftRail).toBeVisible({ timeout: 30_000 });
}

export async function openBlankSheet(page: Page): Promise<void> {
  await ensureBinderOpen(page);
  const sheet = page.getByTestId("binder-artifact").filter({ hasText: /Sheet 1|Sheet|Q3 variance/i }).first();
  if (await sheet.isVisible().catch(() => false)) {
    await sheet.click({ timeout: 30_000 });
  }
  await expect(page.getByTestId("sheet-grid").or(page.locator(noderoomSelectors.sheetSurface)).first()).toBeVisible({ timeout: 45_000 });
}

export async function uploadFiles(page: Page, inputRefs: string[]): Promise<string[]> {
  for (const inputRef of inputRefs) {
    expect(existsSync(resolve(process.cwd(), inputRef)), `input ref exists: ${inputRef}`).toBe(true);
  }
  await ensureBinderOpen(page);
  const fileInput = page.locator(".r-file-input");
  await fileInput.waitFor({ state: "attached", timeout: 30_000 });
  const payloads = inputRefs.map((inputRef) => ({
    name: basename(inputRef),
    mimeType: mimeFor(inputRef),
    buffer: Buffer.from(readFileSync(resolve(process.cwd(), inputRef))),
  }));
  await fileInput.setInputFiles(payloads);
  const missing = await waitForUploadedLabels(page, payloads.map((payload) => payload.name), 60_000);
  if (missing.length > 0) {
    throw new Error(`Uploaded files did not surface in the live Binder: ${missing.join(", ")}`);
  }
  return payloads.map((payload) => payload.name);
}

export async function selectAgentRoute(page: Page, options: Pick<InternalLiveRoomOptions, "agentModelMode" | "agentModelPolicy">): Promise<void> {
  const preset = page.locator(noderoomSelectors.chatModelPreset).first();
  await expect(preset).toBeVisible({ timeout: 30_000 });
  if (options.agentModelMode !== "adaptive") await preset.selectOption(options.agentModelMode);
  if (options.agentModelMode === "specific") {
    await page.locator(noderoomSelectors.chatModelSpecific).first().fill(options.agentModelPolicy);
  }
  await expect(preset).toHaveValue(options.agentModelMode, { timeout: 30_000 });
}

export async function invokePublicNodeAgent(
  page: Page,
  prompt: string,
  expected: { userMessageNeedle: string; completionPhrase?: string },
  options: InternalLiveRoomOptions,
): Promise<InternalNodeAgentProof> {
  const startedAt = Date.now();
  const gatesProven: string[] = [];
  const gatesNotProven: Record<string, string> = {};
  const streams = page.locator(noderoomSelectors.agentStream);
  const streamCountBeforeSend = await streams.count().catch(() => 0);
  const composer = page.locator(noderoomSelectors.chatComposer).first();
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(withNodeAgentMention(prompt));
  await page.locator(noderoomSelectors.chatSend).first().click();

  const userMessageVisible = await expect(page.getByTestId("chat-message").filter({ hasText: expected.userMessageNeedle }).first())
    .toBeVisible({ timeout: 20_000 })
    .then(() => true, () => false);
  if (userMessageVisible) gatesProven.push("public_nodeagent_invocation");
  else gatesNotProven.public_nodeagent_invocation = "User prompt was not visible in public chat.";

  let stream = streams.last();
  const streamingVisible = await waitForNewAgentStream(page, streamCountBeforeSend, options.streamTimeoutMs)
    .then((newStream) => {
      stream = newStream;
      return true;
    }, () => streams.last().isVisible().catch(() => false));
  if (streamingVisible) gatesProven.push("visible_streaming_progress");
  else gatesNotProven.visible_streaming_progress = "No new visible agent stream appeared after send.";

  const jobStatusVisible = await expect(page.locator(noderoomSelectors.jobStatus).first())
    .toContainText(/queued|running|completed|blocked|failed/i, { timeout: 60_000 })
    .then(() => true, () => false);
  if (jobStatusVisible) gatesProven.push("agent_live_loop");
  else gatesNotProven.agent_live_loop = "No durable job-status signal appeared.";

  const jobDetailVisible = await openJobDetail(page);
  if (jobDetailVisible) gatesProven.push("job_detail_visible");
  else gatesNotProven.job_detail_visible = "No job detail drawer was visible.";

  const completion = await waitForCompletion(page, stream, {
    timeoutMs: options.agentTimeoutMs,
    completionPhrase: expected.completionPhrase,
    requireCompletionPhrase: options.requireCompletionPhrase === true,
  });
  if (completion.completionVisible) gatesProven.push("agent_terminal_quality_gate");
  else gatesNotProven.agent_terminal_quality_gate = completion.reason ?? "Agent did not reach terminal status before timeout.";

  const roomTraceVisible = await page.locator(noderoomSelectors.roomTrace).first().isVisible().catch(() => false);
  if (roomTraceVisible) gatesProven.push("room_trace_visible");
  else gatesNotProven.room_trace_visible = "Room trace was not visible in the browser UI.";

  const telemetry = await latestRunTelemetry(page);
  return {
    userMessageVisible,
    streamingVisible,
    jobStatusVisible,
    jobDetailVisible,
    roomTraceVisible,
    completionVisible: completion.completionVisible,
    finalTextSample: completion.finalTextSample,
    durationMs: Date.now() - startedAt,
    telemetry,
    gatesProven,
    gatesNotProven,
  };
}

export function modelReceipt(options: Pick<InternalLiveRoomOptions, "agentModelMode" | "agentModelPolicy" | "runtimeProfile">, proofs: InternalNodeAgentProof[]) {
  const telemetry = proofs.map((proof) => proof.telemetry);
  const routeIntegrity = evaluateProofloopRouteIntegrity({
    requestedModel: options.agentModelPolicy,
    telemetry,
  });
  return {
    provider: providerForAgentModelPolicy(options.agentModelPolicy),
    mode: options.agentModelMode,
    policy: options.agentModelPolicy,
    runtimeProfile: options.runtimeProfile || "standard",
    realUserMode: options.runtimeProfile === "",
    routeIntegrity,
    measuredCostUsd: sumNullable(telemetry.map((row) => row?.costUsd ?? null)),
    measuredTokensIn: sumNullable(telemetry.map((row) => row?.inputTokens ?? null)),
    measuredTokensOut: sumNullable(telemetry.map((row) => row?.outputTokens ?? null)),
    telemetry,
  };
}

export function routeIntegrityFailedGates(model: { routeIntegrity?: ProofloopRouteIntegrity }): string[] {
  const integrity = model.routeIntegrity;
  if (!integrity || integrity.status === "matched") return [];
  return [`model_route_mismatch: ${routeIntegrityFailureSummary(integrity) ?? "model route integrity could not be proven"}`];
}

export function outputDir(kind: string, runId: string): string {
  const dir = process.env.PROOFLOOP_OUTPUT_DIR ?? join(process.cwd(), ".proofloop", "runs", runId, kind);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

export function renderInternalScorecard(args: {
  title: string;
  status: string;
  roomUrl: string;
  taskRows: Array<{ taskId: string; title: string; passed: boolean; failedGates: string[] }>;
  problemCounts: Record<string, number>;
}): string {
  return [
    `# ${args.title}`,
    "",
    `Status: ${args.status}`,
    `Room: ${args.roomUrl}`,
    "",
    "## Tasks",
    "",
    "| Task | Status | Failed gates |",
    "|---|---|---|",
    ...args.taskRows.map((task) => `| ${task.taskId} | ${task.passed ? "pass" : "fail"} | ${task.failedGates.join("; ") || "none"} |`),
    "",
    "## Browser Problems",
    "",
    ...Object.entries(args.problemCounts).map(([key, value]) => `- ${key}: ${value}`),
    "",
  ].join("\n");
}

async function waitForCompletion(
  page: Page,
  stream: Locator,
  options: { timeoutMs: number; completionPhrase?: string; requireCompletionPhrase?: boolean },
): Promise<{ completionVisible: boolean; finalTextSample: string; reason?: string }> {
  const deadline = Date.now() + options.timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    const status = await quickText(page.locator(noderoomSelectors.jobStatus).first());
    const streamText = await quickText(stream, 1_000);
    const latestStreamText = await quickText(page.locator(noderoomSelectors.agentStream).last(), 1_000);
    const chatText = await quickText(page.getByTestId("chat-message").last(), 1_000);
    const errorText = await quickText(page.getByTestId("agent-error").first(), 500);
    const combined = [status, streamText, latestStreamText, chatText, errorText].filter(Boolean).join("\n");
    lastText = combined.slice(-6_000);
    const sawPhrase = options.completionPhrase
      ? combined.toLowerCase().includes(options.completionPhrase.toLowerCase())
      : false;
    const terminal = /\b(completed|done)\b/i.test(status) || /\bNodeAgent completed\b/i.test(combined);
    const failed = /\b(failed|blocked|cancelled|canceled)\b/i.test(status)
      || /\bNodeAgent needs attention\b/i.test(combined)
      || /\btool_argument_error\b/i.test(combined)
      || Boolean(errorText);
    if (failed) return { completionVisible: false, finalTextSample: lastText, reason: `Agent failed or blocked: ${lastText}` };
    if (options.requireCompletionPhrase ? sawPhrase : (terminal || sawPhrase)) {
      return { completionVisible: true, finalTextSample: lastText };
    }
    await page.waitForTimeout(2_000);
  }
  return { completionVisible: false, finalTextSample: lastText, reason: `Timed out after ${options.timeoutMs}ms.` };
}

async function waitForNewAgentStream(page: Page, previousCount: number, timeoutMs: number): Promise<Locator> {
  const streams = page.locator(noderoomSelectors.agentStream);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await streams.count().catch(() => 0);
    if (count > previousCount) {
      const stream = streams.nth(previousCount);
      if (await stream.isVisible().catch(() => false)) return stream;
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error(`Timed out waiting for new agent stream; previous=${previousCount}, current=${await streams.count().catch(() => 0)}`);
}

async function openJobDetail(page: Page): Promise<boolean> {
  const detail = page.locator(noderoomSelectors.jobDetail).first();
  if (await detail.isVisible().catch(() => false)) return true;
  const toggle = page.locator(noderoomSelectors.jobDetailToggle).first();
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click({ timeout: 10_000 }).catch(() => undefined);
  }
  return detail.isVisible().catch(() => false);
}

async function latestRunTelemetry(page: Page): Promise<LiveRunTelemetry | null> {
  const locator = page.locator(".r-trace-tele").last();
  if (!(await locator.isVisible({ timeout: 10_000 }).catch(() => false))) return null;
  const rawText = ((await locator.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  const rawTitle = ((await locator.getAttribute("title").catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  const costMatch = rawText.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
  const toolMatch = rawText.match(/(?:^|[^0-9A-Za-z])\s*([0-9,]+)\s+tools?\b/i);
  const modelMatch = rawText.match(/^(.+?)\s+[^0-9A-Za-z\s]\s+/);
  const model = modelMatch?.[1]?.trim() || rawText.replace(/\b[0-9,]+\s+tools?\b.*$/i, "").trim();
  const titleMatch = rawTitle.match(/([0-9,]+)\s+steps\s+[^0-9]+([0-9,]+)\s+in\s+\+\s+([0-9,]+)\s+out\s+tokens\s+[^0-9]+([0-9,]+)ms/i);
  return {
    model,
    toolCalls: toolMatch ? parseCount(toolMatch[1]) : null,
    steps: titleMatch ? parseCount(titleMatch[1]) : null,
    inputTokens: titleMatch ? parseCount(titleMatch[2]) : null,
    outputTokens: titleMatch ? parseCount(titleMatch[3]) : null,
    latencyMs: titleMatch ? parseCount(titleMatch[4]) : null,
    costUsd: costMatch ? Number(costMatch[1]) : null,
    rawText,
    rawTitle,
  };
}

async function waitForUploadedLabels(page: Page, names: string[], timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let missing = names.slice();
  while (Date.now() < deadline) {
    await ensureBinderOpen(page);
    const visibleText = await visibleRoomEvidenceText(page);
    missing = names.filter((name) => !uploadedLabelVisible(visibleText, name));
    if (missing.length === 0) return [];
    if (!(await isUploadUiBusy(page)) && Date.now() + 2_000 >= deadline) return missing;
    await page.waitForTimeout(1_000);
  }
  return missing;
}

async function visibleRoomEvidenceText(page: Page): Promise<string> {
  const chunks = await page.locator([
    '[data-testid="binder-artifact"]',
    '[data-testid="left-rail"]',
    '[data-testid="artifact-panel"]',
    '[data-testid="room-trace"]',
    '[data-testid="shell-bottom"]',
  ].join(",")).evaluateAll((els) => els.map((el) => [
    el.getAttribute("data-artifact-title") ?? "",
    el.textContent ?? "",
  ].join("\n")));
  return chunks.join("\n");
}

async function isUploadUiBusy(page: Page): Promise<boolean> {
  if (await page.locator('.r-upload[aria-busy="true"], button[aria-busy="true"]').first().isVisible().catch(() => false)) {
    return true;
  }
  if (await page.getByText(/Uploading(?: files)?\.\.\./i).first().isVisible().catch(() => false)) {
    return true;
  }
  return page.getByTestId("chat-upload-status").first().isVisible().catch(() => false);
}

async function clickWhenVisible(locator: Locator, timeout: number): Promise<boolean> {
  const visible = await locator.waitFor({ state: "visible", timeout }).then(() => true, () => false);
  if (!visible) return false;
  await locator.click({ timeout });
  return true;
}

async function quickText(locator: Locator, timeout = 250): Promise<string> {
  return ((await locator.textContent({ timeout }).catch(() => "")) ?? "");
}

function uploadedLabelVisible(visibleText: string, filename: string): boolean {
  const normalized = visibleText.toLowerCase();
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").toLowerCase();
  return normalized.includes(filename.toLowerCase()) || normalized.includes(stem);
}

function mimeFor(file: string): string {
  if (/\.pdf$/i.test(file)) return "application/pdf";
  if (/\.csv$/i.test(file)) return "text/csv";
  if (/\.json$/i.test(file)) return "application/json";
  if (/\.md$/i.test(file)) return "text/markdown";
  if (/\.xlsx$/i.test(file)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

function parseCount(value: string): number {
  return Number(value.replace(/,/g, ""));
}

function sumNullable(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!numbers.length) return null;
  return Number(numbers.reduce((sum, value) => sum + value, 0).toFixed(6));
}
