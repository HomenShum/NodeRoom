import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import {
  RALPH_MILESTONES,
  SOLO_MILESTONE_CONTRACTS,
  evaluateSoloMilestoneStart,
  initSoloLoop,
  readSoloLoopState,
  soloPath,
  startSoloMilestone,
  verifySoloMilestone,
  writeSoloLoopState,
  type RalphMilestone,
} from "../src/solo/ralphLoopLedger";
import {
  SOLO_AGENT_TARGETS,
  appendSoloBusEvent,
  createSoloEvent,
  installSoloHookTemplates,
  readSoloBusEvents,
  renderAgentMatrix,
  type SoloAgentTarget,
  type SoloEventType,
} from "../src/solo/soloEventBus";
import {
  renderLoopDoctor,
  renderNodeRoomWatch,
  renderProofCaseSummary,
  renderSfnAgentMatrix,
  renderSfnDashboard,
} from "../src/solo/sfnCommandCenter";
import {
  buildBtbFreshRoomMatrixPlan,
  btbTaskCoverageReceiptErrors,
  readBtbFreshRoomMatrixStatus,
  writeBtbFreshRoomMatrixLedger,
  type BtbFreshRoomMatrixOptions,
  type BtbFreshRoomMatrixPlan,
  type BtbFreshRoomMatrixTask,
} from "../src/solo/btbFreshRoomMatrix";
import {
  freshRoomProofPath,
  readFreshRoomProofReceipt,
  validateFreshRoomProofReceipt,
} from "../src/eval/freshRoomProofReceipts";
import {
  buildSfnProofRunCommand,
  getSfnProofCase,
  missingExpectedProofFiles,
} from "../src/solo/proofCaseRegistry";

const args = process.argv.slice(2);

async function main(): Promise<void> {
  const [scope, command] = args;
  const projectRoot = optionValue("--project") ?? ".";

  if (!scope || scope === "help" || scope === "--help" || scope === "-h") {
    printUsage();
    return;
  }
  if (scope === "dashboard") {
    console.log(renderSfnDashboard({ projectRoot, caseId: optionValue("--case") ?? "FR-010" }));
    return;
  }
  if (scope === "loop") {
    await handleLoop(command, projectRoot);
    return;
  }
  if (scope === "agent") {
    await handleAgent(command, projectRoot);
    return;
  }
  if (scope === "proof") {
    await handleProof(command);
    return;
  }
  if (scope === "noderoom") {
    await handleNodeRoom(command);
    return;
  }
  if (scope === "memory") {
    printContractOnly("memory", ["add", "search", "quarantine", "export-okf", "doctor"]);
    return;
  }
  if (scope === "rework") {
    printContractOnly("rework", ["add", "list", "explain"]);
    return;
  }
  if (scope === "design") {
    printContractOnly("design", ["flow", "gate", "receipt", "compare"]);
    return;
  }
  printUsage();
  process.exitCode = 1;
}

async function handleLoop(command: string | undefined, projectRoot: string): Promise<void> {
  if (command === "init") {
    const goal = optionValue("--goal");
    if (!goal) fail("loop init requires --goal");
    const state = initSoloLoop({ projectRoot, goal });
    console.log(`Initialized RALPH loop ${state.loopId}`);
    console.log(`State: ${soloPath(projectRoot, "loop-state.json")}`);
    console.log(`Resume: npm run sfn -- loop resume --loop-id ${state.loopId}`);
    return;
  }
  if (command === "status") {
    const state = requireLoop(projectRoot);
    console.log(`${state.loopId} :: ${state.status} :: current=${state.currentMilestone}`);
    console.log(state.goal);
    for (const milestone of RALPH_MILESTONES) {
      const row = state.milestones[milestone];
      console.log(`${milestone} ${SOLO_MILESTONE_CONTRACTS[milestone].label}: ${row.status}`);
      if (row.blockedOn) console.log(`  blocked: ${row.blockedOn.message}\n  next: ${row.blockedOn.nextAction}`);
    }
    return;
  }
  if (command === "resume") {
    const state = requireLoop(projectRoot);
    const expectedLoopId = optionValue("--loop-id");
    if (expectedLoopId && expectedLoopId !== state.loopId) fail(`Loop id mismatch. Found ${state.loopId}, got ${expectedLoopId}.`);
    const current = state.milestones[state.currentMilestone];
    console.log(`Resume ${state.loopId} at ${state.currentMilestone}: ${SOLO_MILESTONE_CONTRACTS[state.currentMilestone].label}`);
    if (current.blockedOn) {
      console.log(`Blocked: ${current.blockedOn.message}`);
      console.log(`Next: ${current.blockedOn.nextAction}`);
    } else {
      console.log(`Next: npm run sfn -- loop start --from ${state.currentMilestone}`);
    }
    return;
  }
  if (command === "start") {
    const milestone = parseMilestone(optionValue("--from") ?? "R");
    const result = startSoloMilestone(projectRoot, milestone);
    if (result.allowed) {
      console.log(`Started ${milestone}: ${SOLO_MILESTONE_CONTRACTS[milestone].label}`);
      return;
    }
    console.log(`Cannot start ${milestone}.`);
    console.log("Missing:");
    for (const item of result.missing) console.log(`  - ${item}`);
    console.log(`Resume: ${result.resumeCommand}`);
    process.exitCode = 2;
    return;
  }
  if (command === "pause") {
    const state = requireLoop(projectRoot);
    state.status = "blocked";
    state.milestones[state.currentMilestone].status = "blocked";
    state.milestones[state.currentMilestone].blockedOn = {
      kind: "approval",
      message: optionValue("--message") ?? "Loop paused by operator.",
      nextAction: `npm run sfn -- loop resume --loop-id ${state.loopId}`,
    };
    writeSoloLoopState(projectRoot, state);
    console.log(`Paused ${state.loopId}`);
    return;
  }
  if (command === "events") {
    const events = readSoloBusEvents(projectRoot);
    for (const event of events) console.log(`${event.createdAt} ${event.agent} ${event.event} ${event.phase ?? ""} ${event.status ?? ""}`);
    if (!events.length) console.log("No events recorded.");
    return;
  }
  if (command === "doctor") {
    console.log(renderLoopDoctor(projectRoot));
    return;
  }
  if (command === "verify") {
    const milestone = parseMilestone(optionValue("--milestone") ?? optionValue("--from") ?? "P");
    const result = verifySoloMilestone(projectRoot, milestone);
    if (result.ok) {
      console.log(`Verified ${milestone}: ${SOLO_MILESTONE_CONTRACTS[milestone].label}`);
      return;
    }
    console.log(`Cannot verify ${milestone}.`);
    for (const error of result.errors) console.log(`  - ${error}`);
    process.exitCode = 2;
    return;
  }
  if (command === "can-start") {
    const milestone = parseMilestone(optionValue("--from") ?? "R");
    const result = evaluateSoloMilestoneStart(projectRoot, milestone);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.allowed ? 0 : 2;
    return;
  }
  printUsage();
  process.exitCode = 1;
}

async function handleAgent(command: string | undefined, projectRoot: string): Promise<void> {
  if (command === "list") {
    console.log(SOLO_AGENT_TARGETS.join("\n"));
    return;
  }
  if (command === "matrix") {
    console.log(optionFlag("--plain") ? renderAgentMatrix() : renderSfnAgentMatrix());
    return;
  }
  if (command === "install-hooks") {
    const target = parseTarget(optionValue("--target") ?? "generic");
    const written = installSoloHookTemplates(projectRoot, target);
    console.log(`Installed ${target} hook templates:`);
    for (const file of written) console.log(`  - ${file}`);
    return;
  }
  if (command === "collect") {
    const eventType = parseEventType(optionValue("--event") ?? "tool.post");
    const agent = parseTarget(optionValue("--target") ?? optionValue("--agent") ?? "generic");
    const phase = optionValue("--phase") ? parseMilestone(optionValue("--phase")!) : undefined;
    const event = createSoloEvent({
      event: eventType,
      agent,
      phase,
      status: "ok",
      command: optionValue("--command"),
      receiptPath: optionValue("--receipt"),
    });
    await appendSoloBusEvent(projectRoot, event);
    console.log(`Recorded ${event.event} for ${event.agent}`);
    return;
  }
  if (command === "run" || command === "fanout") {
    console.log("Agent run/fanout is contract-only in this CLI pass.");
    console.log("Use native hooks/API sessions where available, then require proof receipts before claims.");
    return;
  }
  printUsage();
  process.exitCode = 1;
}

async function handleProof(command: string | undefined): Promise<void> {
  const caseId = optionValue("--case") ?? "FR-010";
  const path = freshRoomProofPath(caseId);
  const receipt = readFreshRoomProofReceipt(path);
  if (command === "receipt") {
    if (!receipt) {
      console.log(`Missing receipt: ${path}`);
      process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }
  if (command === "verify") {
    if (!receipt) {
      console.log(`Missing receipt: ${path}`);
      process.exitCode = 2;
      return;
    }
    const result = validateFreshRoomProofReceipt(receipt, { caseId, requireOfficialScorer: receipt.gatesProven.includes("official_scorer_handoff") });
    console.log(result.ok ? `Proof ${caseId}: pass` : `Proof ${caseId}: fail`);
    for (const error of result.errors) console.log(`  - ${error}`);
    process.exitCode = result.ok ? 0 : 2;
    return;
  }
  if (command === "verdict") {
    console.log(renderProofCaseSummary(caseId));
    return;
  }
  if (command === "run") {
    const proofCase = getSfnProofCase(caseId);
    const run = buildSfnProofRunCommand(caseId, {
      headed: optionFlag("--headed"),
      baseUrl: optionValue("--base-url"),
      bundleRoot: optionValue("--bundle-root"),
      verifierCommand: optionValue("--verifier-command"),
      taskId: optionValue("--task-id"),
      agentModelMode: optionValue("--model-mode"),
      agentModelPolicy: optionValue("--model-policy"),
    });
    console.log(`Running ${caseId}: ${proofCase.title}`);
    console.log(`Claim level: ${proofCase.fullBenchmarkClaim}`);
    console.log(`${run.command} ${run.args.join(" ")}`);
    if (optionFlag("--dry-run")) {
      console.log(JSON.stringify({ env: run.env, expectedFiles: run.expectedFiles, receiptPath: run.receiptPath }, null, 2));
      return;
    }
    const result = spawnSync(run.command, run.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...run.env },
      stdio: "inherit",
      shell: process.platform === "win32",
      timeout: proofCase.defaultTimeoutMs,
    });
    if (result.error) {
      console.error(String(result.error.message ?? result.error));
      process.exitCode = 1;
      return;
    }
    const missing = missingExpectedProofFiles(caseId);
    if ((result.status ?? 0) !== 0 || missing.length) {
      console.log(`Proof ${caseId} did not complete cleanly.`);
      for (const file of missing) console.log(`  missing: ${file}`);
      process.exitCode = result.status ?? 2;
      return;
    }
    console.log(renderProofCaseSummary(caseId));
    return;
  }
  if (command === "init" || command === "publish") {
    console.log(`${command} is contract-only until a target publisher is configured.`);
    return;
  }
  printUsage();
  process.exitCode = 1;
}

async function handleNodeRoom(command: string | undefined): Promise<void> {
  const caseId = optionValue("--case") ?? "FR-010";
  if (command === "watch" || command === "focus") {
    console.log(renderNodeRoomWatch(caseId));
    return;
  }
  if (command === "btb-status") {
    const options = btbMatrixOptionsFromArgs({ headed: false });
    const status = readBtbFreshRoomMatrixStatus(options);
    writeBtbFreshRoomMatrixLedger(readBtbFreshRoomMatrixStatus(btbFullLedgerOptions(options)));
    console.log(renderBtbMatrixStatus(status));
    return;
  }
  if (command === "btb-matrix" || command === "run-btb-matrix") {
    const options = btbMatrixOptionsFromArgs({ headed: !optionFlag("--headless") });
    const plan = buildBtbFreshRoomMatrixPlan(options);
    const status = readBtbFreshRoomMatrixStatus(options);
    if (optionFlag("--write-ledger")) {
      writeBtbFreshRoomMatrixLedger(readBtbFreshRoomMatrixStatus(btbFullLedgerOptions(options)));
    }
    console.log(renderBtbMatrixPlan(plan));
    console.log(renderBtbMatrixStatus(status));
    if (optionValue("--json-out")) writeJsonFile(optionValue("--json-out")!, { plan, status });
    if (optionFlag("--dry-run") || (command === "btb-matrix" && !optionFlag("--run"))) return;
    const failed = await runBtbMatrixPlan(plan, {
      maxParallel: parseIntegerOption("--max-parallel") ?? 1,
      continueOnFail: optionFlag("--continue-on-fail"),
      force: optionFlag("--force"),
    });
    const finalStatus = readBtbFreshRoomMatrixStatus(options);
    writeBtbFreshRoomMatrixLedger(readBtbFreshRoomMatrixStatus(btbFullLedgerOptions(options)));
    console.log(renderBtbMatrixStatus(finalStatus));
    if (optionValue("--json-out")) writeJsonFile(optionValue("--json-out")!, { plan, status: finalStatus });
    process.exitCode = failed > 0 || finalStatus.provenTaskCount < finalStatus.selectedTaskCount ? 2 : 0;
    return;
  }
  if (command === "export-proof") {
    const path = freshRoomProofPath(caseId);
    if (!existsSync(path)) {
      console.log(`Missing receipt: ${path}`);
      process.exitCode = 2;
      return;
    }
    console.log(readFileSync(path, "utf8"));
    return;
  }
  if (command === "run-fresh-room") {
    const proofCase = getSfnProofCase(caseId);
    const run = buildSfnProofRunCommand(caseId, {
      headed: !optionFlag("--headless"),
      baseUrl: optionValue("--base-url"),
      bundleRoot: optionValue("--bundle-root"),
      verifierCommand: optionValue("--verifier-command"),
      taskId: optionValue("--task-id"),
      agentModelMode: optionValue("--model-mode"),
      agentModelPolicy: optionValue("--model-policy"),
    });
    console.log(`NodeRoom fresh-room run: ${caseId} (${proofCase.title})`);
    console.log(`Browser visible: yes`);
    console.log(`${run.command} ${run.args.join(" ")}`);
    if (optionFlag("--dry-run")) {
      console.log(JSON.stringify({ env: run.env, expectedFiles: run.expectedFiles, receiptPath: run.receiptPath }, null, 2));
      return;
    }
    const result = spawnSync(run.command, run.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...run.env },
      stdio: "inherit",
      shell: process.platform === "win32",
      timeout: proofCase.defaultTimeoutMs,
    });
    if (result.error) {
      console.error(String(result.error.message ?? result.error));
      process.exitCode = 1;
      return;
    }
    const missing = missingExpectedProofFiles(caseId);
    if ((result.status ?? 0) !== 0 || missing.length) {
      console.log(`NodeRoom proof ${caseId} did not complete cleanly.`);
      for (const file of missing) console.log(`  missing: ${file}`);
      process.exitCode = result.status ?? 2;
      return;
    }
    console.log(renderNodeRoomWatch(caseId));
    return;
  }
  if (command === "judge-video") {
    console.log("Video judge requires GOOGLE_GENERATIVE_AI_API_KEY and a configured media judge command.");
    return;
  }
  printUsage();
  process.exitCode = 1;
}

function requireLoop(projectRoot: string) {
  const state = readSoloLoopState(projectRoot);
  if (!state) fail("No .solo/loop-state.json exists. Run: npm run sfn -- loop init --goal \"...\"");
  return state;
}

function parseMilestone(value: string): RalphMilestone {
  if ((RALPH_MILESTONES as readonly string[]).includes(value)) return value as RalphMilestone;
  fail(`Unknown milestone ${value}; expected one of ${RALPH_MILESTONES.join(", ")}.`);
}

function parseTarget(value: string): SoloAgentTarget {
  if ((SOLO_AGENT_TARGETS as readonly string[]).includes(value)) return value as SoloAgentTarget;
  fail(`Unknown target ${value}; expected one of ${SOLO_AGENT_TARGETS.join(", ")}.`);
}

function parseEventType(value: string): SoloEventType {
  const allowed = [
    "session.start", "session.stop", "phase.start", "phase.stop", "prompt.submit", "tool.pre", "tool.post", "tool.error",
    "file.read.pre", "file.write.pre", "file.write.post", "command.run.pre", "command.run.post", "browser.proof.start",
    "browser.proof.stop", "receipt.write", "memory.write", "eval.start", "eval.stop", "rework.recorded",
  ];
  if (allowed.includes(value)) return value as SoloEventType;
  fail(`Unknown event ${value}; expected one of ${allowed.join(", ")}.`);
}

function optionValue(name: string): string | undefined {
  return optionValues(name)[0];
}

function optionValues(name: string): string[] {
  const inlinePrefix = `${name}=`;
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(inlinePrefix)) {
      values.push(arg.slice(inlinePrefix.length));
      continue;
    }
    const next = args[index + 1];
    if (arg === name && next && !next.startsWith("--")) values.push(next);
  }
  return values;
}

function optionFlag(name: string): boolean {
  return args.includes(name);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function printContractOnly(scope: string, commands: string[]): void {
  console.log(`sfn ${scope}: ${commands.join(", ")}`);
  console.log("Contract-only in this CLI pass. Receipts remain mandatory before claims.");
}

function printUsage(): void {
  console.log([
    "Usage:",
    "  npm run sfn -- dashboard --case FR-010",
    "  npm run sfn -- loop init --goal \"build agent for this app\"",
    "  npm run sfn -- loop resume --loop-id <id>",
    "  npm run sfn -- loop start --from A --project .",
    "  npm run sfn -- loop verify --milestone P",
    "  npm run sfn -- loop events",
    "  npm run sfn -- loop doctor",
    "  npm run sfn -- agent matrix",
    "  npm run sfn -- agent install-hooks --target codex",
    "  npm run sfn -- proof receipt --case FR-010",
    "  npm run sfn -- proof verify --case FR-010",
    "  npm run sfn -- proof verdict --case FR-010",
    "  npm run sfn -- noderoom watch --case FR-010",
    "  npm run sfn -- noderoom btb-status",
    "  npm run sfn -- noderoom btb-matrix --limit 5 --dry-run",
    "  npm run sfn -- noderoom run-btb-matrix --limit 5 --headed --max-parallel 1",
    "  npm run sfn -- noderoom run-btb-matrix --missing-only --headed --max-parallel 3 --continue-on-fail",
    "  npm run sfn -- noderoom run-btb-matrix --task-id <id> --force --recover-room-code <room> --recover-trace-path <trace.zip> --headed",
  ].join("\n"));
}

function btbMatrixOptionsFromArgs(defaults: { headed: boolean }): BtbFreshRoomMatrixOptions {
  const shard = parseShardOption();
  return {
    headed: defaults.headed,
    baseUrl: optionValue("--base-url"),
    bundleRoot: optionValue("--bundle-root"),
    verifierCommand: optionValue("--verifier-command"),
    agentModelMode: optionValue("--model-mode"),
    agentModelPolicy: optionValue("--model-policy"),
    recoverRoomCode: optionValue("--recover-room-code") ?? optionValue("--room"),
    recoverTracePath: optionValue("--recover-trace-path"),
    recoverFreshRoom: optionFlag("--no-recover-fresh-room") ? false : optionFlag("--recover-fresh-room") ? true : undefined,
    missingOnly: optionFlag("--missing-only"),
    force: optionFlag("--force"),
    offset: parseIntegerOption("--offset"),
    limit: parseIntegerOption("--limit"),
    taskIds: parseTaskIds([...optionValues("--task-id"), ...optionValues("--task-ids")]),
    shardIndex: shard?.index ?? parseIntegerOption("--shard-index"),
    shardCount: shard?.count ?? parseIntegerOption("--shard-count"),
  };
}

function btbFullLedgerOptions(options: BtbFreshRoomMatrixOptions): BtbFreshRoomMatrixOptions {
  return {
    headed: options.headed,
    baseUrl: options.baseUrl,
    bundleRoot: options.bundleRoot,
    verifierCommand: options.verifierCommand,
    agentModelMode: options.agentModelMode,
    agentModelPolicy: options.agentModelPolicy,
  };
}

function parseIntegerOption(name: string): number | undefined {
  const value = optionValue(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) fail(`${name} must be a non-negative integer.`);
  return parsed;
}

function parseTaskIds(values: string[]): string[] | undefined {
  const ids = values.flatMap((value) => value.split(",").map((item) => item.trim()).filter(Boolean));
  return ids.length ? [...new Set(ids)] : undefined;
}

function parseShardOption(): { index: number; count: number } | undefined {
  const value = optionValue("--shard");
  if (!value) return undefined;
  const match = value.match(/^(\d+)\/(\d+)$/);
  if (!match) fail("--shard must use N/M format, for example --shard 1/4");
  const oneBasedIndex = Number(match[1]);
  const count = Number(match[2]);
  if (!Number.isInteger(oneBasedIndex) || !Number.isInteger(count) || oneBasedIndex < 1 || count < 1 || oneBasedIndex > count) {
    fail("--shard must use 1-based N/M values where 1 <= N <= M.");
  }
  return { index: oneBasedIndex - 1, count };
}

function renderBtbMatrixPlan(plan: BtbFreshRoomMatrixPlan): string {
  const lines = [
    "BankerToolBench fresh-room matrix plan",
    `  bundle: ${plan.bundleRoot}`,
    `  selected: ${plan.selectedTaskCount}/${plan.totalTasks}`,
    `  shard: ${plan.shard ? `${plan.shard.index + 1}/${plan.shard.count}` : "none"}`,
    `  offset: ${plan.offset}`,
    `  limit: ${plan.limit ?? "none"}`,
  ];
  if (plan.tasks[0]?.env.BTB_RECOVER_ROOM_CODE) {
    lines.push(`  recovery room: ${plan.tasks[0].env.BTB_RECOVER_ROOM_CODE}`);
  }
  for (const task of plan.tasks.slice(0, 12)) {
    lines.push(`  - ${task.harborTaskId} (${task.taskId}) -> ${task.receiptPath}`);
  }
  if (plan.tasks.length > 12) lines.push(`  ... ${plan.tasks.length - 12} more`);
  if (plan.tasks[0]) {
    lines.push("  first command:");
    lines.push(`    ${plan.tasks[0].command} ${plan.tasks[0].args.join(" ")}`);
  }
  return lines.join("\n");
}

function renderBtbMatrixStatus(status: ReturnType<typeof readBtbFreshRoomMatrixStatus>): string {
  return [
    "BankerToolBench via NodeRoom chat",
    `  bundle: ${status.bundleRoot}`,
    `  official-shaped tasks visible locally: ${status.totalTasks}`,
    `  selected tasks: ${status.selectedTaskCount}`,
    `  fresh-room chat tasks proven: ${status.provenTaskCount}`,
    `  failed receipts: ${status.failedReceiptCount}`,
    `  missing receipts: ${status.missingReceiptCount}`,
    `  pass rate: ${status.passRate.toFixed(4)}`,
    `  full BTB claim: ${status.fullBenchmarkClaim === "ready" ? "ready" : "not ready"}`,
    `  ledger: ${status.ledgerPath}`,
    "  rule: all-task claim requires a fresh-room receipt and verifier row for every task/shard.",
  ].join("\n");
}

async function runBtbMatrixPlan(
  plan: BtbFreshRoomMatrixPlan,
  options: { maxParallel: number; continueOnFail: boolean; force: boolean },
): Promise<number> {
  const maxParallel = Math.max(1, options.maxParallel);
  let next = 0;
  let active = 0;
  let failed = 0;
  let stopped = false;

  return await new Promise((resolvePromise) => {
    const launch = () => {
      if ((next >= plan.tasks.length || stopped) && active === 0) {
        resolvePromise(failed);
        return;
      }
      while (!stopped && active < maxParallel && next < plan.tasks.length) {
        const task = plan.tasks[next++]!;
        if (!options.force && btbMatrixTaskAlreadyPassed(task)) {
          console.log(`\n[btb ${task.index + 1}/${plan.totalTasks}] ${task.harborTaskId} -> skip; passing receipt already exists`);
          continue;
        }
        const reservation = reserveBtbMatrixTask(task);
        if (!reservation) {
          console.log(`\n[btb ${task.index + 1}/${plan.totalTasks}] ${task.harborTaskId} -> skip; another matrix worker is already running it`);
          continue;
        }
        active += 1;
        console.log(`\n[btb ${task.index + 1}/${plan.totalTasks}] ${task.harborTaskId} -> ${task.receiptPath}`);
        clearTaskPlaywrightOutput(task);
        const child = spawn(task.command, task.args, {
          cwd: process.cwd(),
          env: { ...process.env, ...task.env },
          stdio: "inherit",
          shell: process.platform === "win32",
        });
        child.on("exit", (code) => {
          reservation.release();
          active -= 1;
          if ((code ?? 0) !== 0) {
            failed += 1;
            console.error(`[btb ${task.harborTaskId}] failed with exit ${code}`);
            if (!options.continueOnFail) stopped = true;
          }
          launch();
        });
        child.on("error", (error) => {
          reservation.release();
          active -= 1;
          failed += 1;
          console.error(`[btb ${task.harborTaskId}] ${error.message}`);
          if (!options.continueOnFail) stopped = true;
          launch();
        });
      }
    };
    launch();
  });
}

function btbMatrixTaskAlreadyPassed(task: BtbFreshRoomMatrixPlan["tasks"][number]): boolean {
  const receipt = readFreshRoomProofReceipt(task.receiptPath);
  if (!receipt) return false;
  const taskMatches = receipt.taskId === task.taskId || receipt.taskId === task.harborTaskId;
  if (!taskMatches) return false;
  const validation = validateFreshRoomProofReceipt(receipt, {
    caseId: "FR-020",
    requireOfficialScorer: receipt.gatesProven.includes("official_scorer_handoff"),
    requireArtifactPlaceholderScan: true,
    requireAgentTerminalQuality: true,
  });
  return validation.ok && btbTaskCoverageReceiptErrors(receipt).length === 0;
}

function reserveBtbMatrixTask(task: BtbFreshRoomMatrixPlan["tasks"][number]): { release: () => void } | null {
  const lockPath = resolve(process.cwd(), "test-results", "bankertoolbench", "matrix", safePathSegment(task.taskId), "run.lock");
  mkdirSync(dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    const existingPid = Number(readFileSync(lockPath, "utf8").trim());
    if (Number.isFinite(existingPid) && pidIsAlive(existingPid)) return null;
    try { unlinkSync(lockPath); } catch { return null; }
  }
  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, `${process.pid}\n`);
    closeSync(fd);
  } catch {
    return null;
  }
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      try { unlinkSync(lockPath); } catch { /* best-effort cleanup */ }
    },
  };
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearTaskPlaywrightOutput(task: BtbFreshRoomMatrixTask): void {
  const outputFlagIndex = task.args.lastIndexOf("--output");
  const outputPath = outputFlagIndex >= 0 ? task.args[outputFlagIndex + 1] : undefined;
  if (!outputPath) return;
  const absolute = resolve(process.cwd(), outputPath);
  const expectedRoot = resolve(process.cwd(), "test-results", "bankertoolbench", "matrix");
  if (!absolute.startsWith(expectedRoot)) {
    throw new Error(`Refusing to clear unexpected BTB Playwright output path: ${outputPath}`);
  }
  try {
    rmSync(absolute, { recursive: true, force: true });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "EBUSY" || code === "EPERM") {
      console.warn(`Output path is busy; preserving existing Playwright artifacts and continuing: ${outputPath}`);
    } else {
      throw error;
    }
  }
  mkdirSync(dirname(absolute), { recursive: true });
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 160);
}

function writeJsonFile(path: string, value: unknown): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
