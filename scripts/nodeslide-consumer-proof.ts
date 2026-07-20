import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { RoomEngine } from "../src/engine/roomEngine";
import { toNodeSlidePrincipalFromVerifiedActor } from "../src/integrations/nodeslide/hostPrincipal";
import {
  type NodeSlideAgentAdapter,
  type NodeSlideRoomTools,
  runNodeSlideWithNodeAgent,
} from "../src/integrations/nodeslide/nodeAgentAdapter";
import type { AgentModel } from "../src/nodeagent/core/types";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { resolveNodeSlidePackedArtifacts } from "./nodeslide-consumer-artifacts";

type JsonRecord = Record<string, unknown>;

interface PortableDeckSnapshot {
  deck: { id: string; version: number };
  slides: Array<{ id: string; version: number; elementOrder: string[] }>;
  elements: Array<{ id: string; version: number; content?: unknown }>;
}

interface PortablePatchCommand extends JsonRecord {
  id: string;
  deckId: string;
  traceId?: string;
}

interface PortableReceipt {
  id: string;
  operation: string;
  deckVersion: number;
  traceId?: string;
}

interface PortableProposal {
  id: string;
  status: string;
  operations: unknown[];
}

interface PortableResolution {
  status: string;
  snapshot: PortableDeckSnapshot;
  receipt: PortableReceipt;
}

interface PortableRepository {
  getDeck(input: JsonRecord): Promise<PortableDeckSnapshot | null>;
  createProposal(input: JsonRecord): Promise<PortableProposal>;
  resolveProposal(input: JsonRecord): Promise<PortableResolution>;
  listVersions(input: JsonRecord): Promise<Array<{ version: number }>>;
  receiptsForDeck?(deckId: string): PortableReceipt[];
}

interface PortableConformanceResult {
  proposalVersion: number;
  acceptedVersion: number;
  versionCount: number;
  receiptId: string;
  resolution: PortableResolution;
}

interface NodeSlideTestingModule {
  MemoryNodeSlideRepository: new (options: {
    snapshots: PortableDeckSnapshot[];
    now: () => number;
    authorize: (
      principal: { userId: string; permissions: readonly string[] },
      deckId: string,
      action: string,
    ) => void;
  }) => PortableRepository;
  createNodeSlideTestSnapshot(deckId?: string, timestamp?: number): PortableDeckSnapshot;
  createNodeSlideTextPatch(
    snapshot: PortableDeckSnapshot,
    text: string,
    id?: string,
  ): PortablePatchCommand;
  runNodeSlideRepositoryConformance(input: {
    repository: PortableRepository;
    principal: {
      userId: string;
      roles: readonly string[];
      permissions: readonly string[];
    };
    initialSnapshot: PortableDeckSnapshot;
    proposal: PortablePatchCommand;
  }): Promise<PortableConformanceResult>;
}

interface LoadedTestingModule {
  module: NodeSlideTestingModule;
  inputKind: "repository-root" | "packed-artifact";
  packageName: string;
  packageVersion: string;
  integritySha256?: string;
  cleanup: () => Promise<void>;
}

interface ProofOptions {
  root?: string;
  artifact?: string;
  jsonOut?: string;
  skipBuild: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`NodeSlide consumer proof failed: ${message}`);
}

function runNpm(args: string[], cwd: string): void {
  const npmCliCandidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const npmCli = npmCliCandidates.find((candidate) => existsSync(candidate));
  assert(
    npmCli,
    "npm-cli.js was not found. Run this proof through npm run nodeslide:consumer:proof.",
  );
  execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}

async function readPackageIdentity(packageJsonPath: string): Promise<{
  name: string;
  version: string;
}> {
  const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    name?: unknown;
    version?: unknown;
  };
  assert(typeof parsed.name === "string", `${packageJsonPath} has no package name.`);
  assert(typeof parsed.version === "string", `${packageJsonPath} has no package version.`);
  return { name: parsed.name, version: parsed.version };
}

function validateTestingModule(value: unknown): asserts value is NodeSlideTestingModule {
  assert(typeof value === "object" && value !== null, "testing entrypoint is not a module.");
  const module = value as Record<string, unknown>;
  for (const exportName of [
    "MemoryNodeSlideRepository",
    "createNodeSlideTestSnapshot",
    "createNodeSlideTextPatch",
    "runNodeSlideRepositoryConformance",
  ]) {
    assert(typeof module[exportName] === "function", `testing package lacks ${exportName}.`);
  }
}

async function importTestingModule(entrypoint: string): Promise<NodeSlideTestingModule> {
  const imported: unknown = await import(
    `${pathToFileURL(entrypoint).href}?noderoom-consumer=${Date.now()}`
  );
  validateTestingModule(imported);
  return imported;
}

async function loadFromRepositoryRoot(
  rootInput: string,
  skipBuild: boolean,
): Promise<LoadedTestingModule> {
  const root = resolve(rootInput);
  const packageJsonPath = join(root, "packages", "testing", "package.json");
  assert(existsSync(packageJsonPath), `${root} is not a NodeSlide package workspace.`);
  const identity = await readPackageIdentity(packageJsonPath);
  assert(identity.name === "@nodeslide/testing", `${root} does not contain @nodeslide/testing.`);
  if (!skipBuild) runNpm(["run", "packages:build"], root);
  const entrypoint = join(root, "packages", "testing", "dist", "index.js");
  assert(
    existsSync(entrypoint),
    `${entrypoint} is missing. Run NodeSlide's packages:build command first.`,
  );
  return {
    module: await importTestingModule(entrypoint),
    inputKind: "repository-root",
    packageName: identity.name,
    packageVersion: identity.version,
    cleanup: async () => undefined,
  };
}

async function loadFromPackedArtifact(artifactInput: string): Promise<LoadedTestingModule> {
  const artifacts = await resolveNodeSlidePackedArtifacts(artifactInput);
  const artifact = artifacts.testingArtifact;
  const integritySha256 = createHash("sha256")
    .update(await readFile(artifact))
    .digest("hex");
  const temporaryRoot = resolve(tmpdir());
  const installRoot = await mkdtemp(join(temporaryRoot, "noderoom-nodeslide-consumer-"));
  assert(
    installRoot.startsWith(`${temporaryRoot}${sep}`),
    `temporary install escaped ${temporaryRoot}.`,
  );
  try {
    runNpm(
      [
        "install",
        "--prefix",
        installRoot,
        "--ignore-scripts",
        "--no-package-lock",
        "--no-audit",
        "--no-fund",
        ...artifacts.installArtifacts,
      ],
      installRoot,
    );
    const packageRoot = join(installRoot, "node_modules", "@nodeslide", "testing");
    const packageJsonPath = join(packageRoot, "package.json");
    const entrypoint = join(packageRoot, "dist", "index.js");
    assert(existsSync(entrypoint), `${artifact} did not install a testing entrypoint.`);
    const identity = await readPackageIdentity(packageJsonPath);
    assert(identity.name === "@nodeslide/testing", `${artifact} is not @nodeslide/testing.`);
    return {
      module: await importTestingModule(entrypoint),
      inputKind: "packed-artifact",
      packageName: identity.name,
      packageVersion: identity.version,
      integritySha256,
      cleanup: () => rm(installRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(installRoot, { recursive: true, force: true });
    throw error;
  }
}

function parseOptions(): ProofOptions {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      artifact: { type: "string" },
      "json-out": { type: "string" },
      "skip-build": { type: "boolean", default: false },
    },
    strict: true,
  });
  const root = values.root ?? process.env.NODESLIDE_ROOT;
  const artifact = values.artifact ?? process.env.NODESLIDE_PACKAGE_ARTIFACT;
  assert(!(root && artifact), "provide NODESLIDE_ROOT or a packed artifact, not both.");
  assert(
    root || artifact,
    "set NODESLIDE_ROOT or NODESLIDE_PACKAGE_ARTIFACT (or pass --root/--artifact).",
  );
  return {
    ...(root ? { root } : {}),
    ...(artifact ? { artifact } : {}),
    ...(values["json-out"] ? { jsonOut: values["json-out"] } : {}),
    skipBuild: values["skip-build"] ?? false,
  };
}

async function runProof(loaded: LoadedTestingModule): Promise<JsonRecord> {
  const runtime = loaded.module;
  const principal = toNodeSlidePrincipalFromVerifiedActor({
    actor: { kind: "user", id: "user:noderoom-consumer", name: "NodeRoom consumer" },
    membershipRole: "host",
    hostAuthVerified: true,
    allowDeckWrites: true,
  });
  const authChecks: Array<{ deckId: string; action: string }> = [];
  const authorize = (
    candidate: { userId: string; permissions: readonly string[] },
    deckId: string,
    action: string,
  ) => {
    assert(candidate.userId === principal.userId, "repository accepted another principal.");
    const requiredPermission =
      action === "read" || action === "list_versions"
        ? "nodeslide:read"
        : action === "create_proposal"
          ? "nodeslide:propose"
          : "nodeslide:write";
    assert(
      candidate.permissions.includes(requiredPermission),
      `host principal lacks ${requiredPermission}.`,
    );
    authChecks.push({ deckId, action });
  };
  let clock = 1_700_000_001_000;
  const now = () => ++clock;

  const conformanceSnapshot = runtime.createNodeSlideTestSnapshot(
    "deck:noderoom:conformance",
    1_700_000_000_000,
  );
  const conformanceRepository = new runtime.MemoryNodeSlideRepository({
    snapshots: [conformanceSnapshot],
    now,
    authorize,
  });
  const conformancePatch = runtime.createNodeSlideTextPatch(
    conformanceSnapshot,
    "Accepted through the NodeRoom consumer",
    "patch:noderoom:conformance",
  );
  conformancePatch.traceId = "trace:noderoom:conformance";
  const conformance = await runtime.runNodeSlideRepositoryConformance({
    repository: conformanceRepository,
    principal,
    initialSnapshot: conformanceSnapshot,
    proposal: conformancePatch,
  });
  assert(conformance.proposalVersion === 1, "proposal mutated the authoritative deck.");
  assert(conformance.acceptedVersion === 2, "acceptance did not advance the deck to v2.");
  assert(conformance.resolution.status === "accepted", "current proposal was not accepted.");
  assert(
    conformance.resolution.receipt.traceId === conformancePatch.traceId,
    "acceptance receipt lost its trace binding.",
  );

  const nodeAgentSnapshot = runtime.createNodeSlideTestSnapshot(
    "deck:noderoom:nodeagent",
    1_700_000_000_050,
  );
  const nodeAgentRepository = new runtime.MemoryNodeSlideRepository({
    snapshots: [nodeAgentSnapshot],
    now,
    authorize,
  });
  const nodeAgentTraceId = "trace:noderoom:nodeagent";
  const nodeAgentActivity: string[] = [];
  let pendingNodeAgentProposalId: string | undefined;
  const nodeSlideRoomTools: NodeSlideRoomTools = {
    async snapshot() {
      const current = await nodeAgentRepository.getDeck({
        deckId: nodeAgentSnapshot.deck.id,
        principal,
      });
      assert(current, "NodeAgent deck snapshot was not found.");
      return {
        deckId: current.deck.id,
        version: current.deck.version,
        slides: current.slides,
      };
    },
    async readRange({ slideId }) {
      const current = await nodeAgentRepository.getDeck({
        deckId: nodeAgentSnapshot.deck.id,
        principal,
      });
      assert(current, "NodeAgent deck snapshot was not found for readRange.");
      return current.slides.find((slide) => slide.id === slideId) ?? null;
    },
    async proposeLock() {
      return { ok: true };
    },
    async releaseLock() {},
    async applyDeckPatch({ patch, expectedVersion }) {
      const current = await nodeAgentRepository.getDeck({
        deckId: nodeAgentSnapshot.deck.id,
        principal,
      });
      assert(current, "NodeAgent deck snapshot was not found before proposal creation.");
      if (current.deck.version !== expectedVersion) {
        return {
          ok: false,
          conflict: true,
          expected: expectedVersion,
          actual: current.deck.version,
        };
      }
      const proposal = await nodeAgentRepository.createProposal({
        deckId: current.deck.id,
        principal,
        patch: patch as PortablePatchCommand,
      });
      pendingNodeAgentProposalId = proposal.id;
      return { ok: false, pendingApproval: true, proposalId: proposal.id };
    },
    async say(text) {
      nodeAgentActivity.push(text);
    },
  };
  const nodeSlideAgentAdapter = {
    rt: nodeSlideRoomTools,
    tools: [
      {
        name: "nodeslide_propose_text",
        description: "Create an unapplied NodeSlide text proposal for host review.",
        schema: z.object({ text: z.string().min(1) }),
        async execute(args: unknown, rt: NodeSlideRoomTools) {
          const { text } = args as { text: string };
          const current = await rt.snapshot();
          const patch = runtime.createNodeSlideTextPatch(
            nodeAgentSnapshot,
            text,
            "patch:noderoom:nodeagent",
          );
          patch.traceId = nodeAgentTraceId;
          const outcome = await rt.applyDeckPatch({ patch, expectedVersion: current.version });
          await rt.say("NodeAgent created a NodeSlide proposal for host review.");
          return outcome;
        },
      },
    ],
    systemPrompt:
      "Use the supplied NodeSlide tools. Leave deck mutations unapplied until the host reviews them.",
    toolClasses: { nodeslide_propose_text: "mutation" },
  } satisfies NodeSlideAgentAdapter;
  let nodeAgentTurn = 0;
  const nodeAgentModel: AgentModel = {
    name: "nodeslide-consumer-scripted-model",
    async next() {
      nodeAgentTurn += 1;
      if (nodeAgentTurn === 1) {
        return {
          toolCalls: [
            {
              id: "call:noderoom:nodeslide:1",
              tool: "nodeslide_propose_text",
              args: { text: "Proposed through NodeRoom NodeAgent" },
            },
          ],
          done: false,
        };
      }
      return { text: "The deck proposal is ready for host review.", toolCalls: [], done: true };
    },
  };
  const roomEngine = new RoomEngine();
  const demo = buildDemoRoom(roomEngine);
  const nodeRoomTools = new InMemoryRoomTools(
    roomEngine,
    demo.roomId,
    demo.sheetId,
    demo.agents.room,
    demo.sessions.room,
  );
  const nodeAgentResult = await runNodeSlideWithNodeAgent({
    adapter: nodeSlideAgentAdapter,
    rt: nodeRoomTools,
    goal: "Propose a reviewed NodeSlide title change.",
    model: nodeAgentModel,
    maxSteps: 2,
  });
  assert(nodeAgentResult.stopReason === "done", "NodeAgent did not finish the proposal run.");
  assert(nodeAgentResult.trace.length === 1, "NodeAgent did not execute exactly one deck tool.");
  assert(
    nodeAgentResult.trace[0]?.tool === "nodeslide_propose_text",
    "NodeAgent trace did not record the NodeSlide tool.",
  );
  const beforeNodeAgentAcceptance = await nodeAgentRepository.getDeck({
    deckId: nodeAgentSnapshot.deck.id,
    principal,
  });
  assert(
    beforeNodeAgentAcceptance?.deck.version === 1,
    "NodeAgent proposal mutated the authoritative deck before host acceptance.",
  );
  assert(pendingNodeAgentProposalId, "NodeAgent did not create a reviewable proposal.");
  const nodeAgentAcceptance = await nodeAgentRepository.resolveProposal({
    deckId: nodeAgentSnapshot.deck.id,
    principal,
    proposalId: pendingNodeAgentProposalId,
    decision: "accept",
  });
  assert(nodeAgentAcceptance.status === "accepted", "host did not accept the NodeAgent proposal.");
  assert(
    nodeAgentAcceptance.snapshot.deck.version === 2,
    "accepted NodeAgent proposal did not advance the deck to v2.",
  );
  assert(
    nodeAgentAcceptance.receipt.traceId === nodeAgentTraceId,
    "NodeAgent acceptance receipt lost its trace binding.",
  );
  const reloadedNodeAgentSnapshot = await nodeAgentRepository.getDeck({
    deckId: nodeAgentSnapshot.deck.id,
    principal,
  });
  assert(
    reloadedNodeAgentSnapshot?.elements[0]?.content === "Proposed through NodeRoom NodeAgent",
    "accepted NodeAgent edit did not survive repository reload.",
  );
  const serializedNodeAgentSnapshot = JSON.stringify(reloadedNodeAgentSnapshot);
  const reopenedNodeAgentSnapshot = JSON.parse(serializedNodeAgentSnapshot) as PortableDeckSnapshot;
  assert(
    reopenedNodeAgentSnapshot.deck.version === 2 &&
      reopenedNodeAgentSnapshot.elements[0]?.content === "Proposed through NodeRoom NodeAgent",
    "portable snapshot round-trip did not preserve the accepted NodeAgent edit.",
  );

  const casSnapshot = runtime.createNodeSlideTestSnapshot(
    "deck:noderoom:cas",
    1_700_000_000_100,
  );
  const casRepository = new runtime.MemoryNodeSlideRepository({
    snapshots: [casSnapshot],
    now,
    authorize,
  });
  const acceptedCommand = runtime.createNodeSlideTextPatch(
    casSnapshot,
    "Accepted candidate",
    "patch:noderoom:accepted",
  );
  acceptedCommand.traceId = "trace:noderoom:accepted";
  const staleCommand = runtime.createNodeSlideTextPatch(
    casSnapshot,
    "Competing stale candidate",
    "patch:noderoom:stale",
  );
  staleCommand.traceId = "trace:noderoom:stale";

  const acceptedProposal = await casRepository.createProposal({
    deckId: casSnapshot.deck.id,
    principal,
    patch: acceptedCommand,
  });
  const staleProposal = await casRepository.createProposal({
    deckId: casSnapshot.deck.id,
    principal,
    patch: staleCommand,
  });
  assert(
    acceptedProposal.status === "ready" && staleProposal.status === "ready",
    "candidate review state was not ready.",
  );
  assert(
    acceptedProposal.operations.length > 0 && staleProposal.operations.length > 0,
    "candidate review omitted proposed operations.",
  );
  const beforeDecision = await casRepository.getDeck({
    deckId: casSnapshot.deck.id,
    principal,
  });
  assert(beforeDecision?.deck.version === 1, "proposal creation changed canonical state.");

  const accepted = await casRepository.resolveProposal({
    deckId: casSnapshot.deck.id,
    principal,
    proposalId: acceptedProposal.id,
    decision: "accept",
  });
  assert(accepted.status === "accepted", "reviewed proposal was not accepted.");
  assert(accepted.snapshot.deck.version === 2, "accepted proposal did not create v2.");
  assert(
    accepted.snapshot.elements[0]?.content === "Accepted candidate",
    "accepted text was not applied.",
  );
  assert(
    accepted.receipt.operation === "proposal.accepted" &&
      accepted.receipt.traceId === acceptedCommand.traceId,
    "accepted proposal receipt is incomplete.",
  );

  const stale = await casRepository.resolveProposal({
    deckId: casSnapshot.deck.id,
    principal,
    proposalId: staleProposal.id,
    decision: "accept",
  });
  assert(stale.status === "stale", "competing base-version proposal did not fail CAS.");
  assert(stale.snapshot.deck.version === 2, "stale proposal changed canonical deck version.");
  assert(
    stale.receipt.operation === "proposal.stale" && stale.receipt.traceId === staleCommand.traceId,
    "stale proposal receipt is incomplete.",
  );

  const acceptedAgain = await casRepository.resolveProposal({
    deckId: casSnapshot.deck.id,
    principal,
    proposalId: acceptedProposal.id,
    decision: "accept",
  });
  assert(
    acceptedAgain.receipt.id === accepted.receipt.id,
    "idempotent acceptance produced another receipt.",
  );
  const finalSnapshot = await casRepository.getDeck({
    deckId: casSnapshot.deck.id,
    principal,
  });
  const versions = await casRepository.listVersions({
    deckId: casSnapshot.deck.id,
    principal,
  });
  assert(finalSnapshot?.deck.version === 2, "replayed acceptance advanced the version twice.");
  assert(
    versions.map((version) => version.version).sort().join(",") === "1,2",
    "version history is not exactly v1 -> v2.",
  );
  const receipts = casRepository.receiptsForDeck?.(casSnapshot.deck.id) ?? [];
  const receiptOperations = receipts.map((receipt) => receipt.operation);
  for (const required of ["proposal.created", "proposal.accepted", "proposal.stale"]) {
    assert(receiptOperations.includes(required), `receipt ledger lacks ${required}.`);
  }

  return {
    schemaVersion: "noderoom.nodeslide-consumer-proof/v1",
    passed: true,
    package: {
      name: loaded.packageName,
      version: loaded.packageVersion,
      inputKind: loaded.inputKind,
      ...(loaded.integritySha256 ? { integritySha256: loaded.integritySha256 } : {}),
      entrypoint:
        loaded.inputKind === "repository-root"
          ? "packages/testing/dist/index.js"
          : "@nodeslide/testing/dist/index.js",
    },
    host: {
      application: "NodeRoom",
      runtimeChanged: false,
      authAuthority: "NodeRoom ActorProof and room membership (normalization only in this proof)",
      principalId: principal.userId,
      roles: principal.roles,
      permissions: principal.permissions,
      authorizationChecks: authChecks.length,
    },
    lifecycle: {
      proposalVersion: conformance.proposalVersion,
      acceptedVersion: conformance.acceptedVersion,
      conformanceReceiptId: conformance.receiptId,
      reviewedProposalStatus: acceptedProposal.status,
      acceptedStatus: accepted.status,
      acceptedReceipt: accepted.receipt,
      staleStatus: stale.status,
      staleReceipt: stale.receipt,
      finalVersion: finalSnapshot?.deck.version,
      versions: versions.map((version) => version.version).sort(),
      receiptOperations,
      acceptanceReplayWasIdempotent: acceptedAgain.receipt.id === accepted.receipt.id,
      nodeAgent: {
        model: nodeAgentModel.name,
        stopReason: nodeAgentResult.stopReason,
        steps: nodeAgentResult.steps,
        toolTrace: nodeAgentResult.trace.map((event) => event.tool),
        proposalStayedUnapplied: beforeNodeAgentAcceptance?.deck.version === 1,
        acceptedVersion: nodeAgentAcceptance.snapshot.deck.version,
        receipt: nodeAgentAcceptance.receipt,
        adapterStatusMessages: nodeAgentActivity,
        reloadPreservedEdit:
          reloadedNodeAgentSnapshot?.elements[0]?.content ===
          "Proposed through NodeRoom NodeAgent",
        portableSnapshotRoundTrip: reopenedNodeAgentSnapshot.deck.version === 2,
      },
    },
    scope: {
      repositoryPort: true,
      proposalReviewAccept: true,
      compareAndSwap: true,
      versions: true,
      receipts: true,
      existingNodeAgentRuntime: true,
      agentProposalStayedUnapplied: true,
      reload: true,
      portableSnapshotRoundTrip: true,
      productionCreate: false,
      manualArtifactEdit: false,
      productionBackend: false,
      sameSnapshotMemoryAndConvex: false,
      durableRoomActivity: false,
      mountedReactStudio: false,
      presenter: false,
      pptxExport: false,
      exportedSnapshotRevalidation: false,
    },
  };
}

async function main(): Promise<void> {
  const options = parseOptions();
  const loaded = options.root
    ? await loadFromRepositoryRoot(options.root, options.skipBuild)
    : await loadFromPackedArtifact(options.artifact as string);
  try {
    const proof = await runProof(loaded);
    const serialized = `${JSON.stringify(proof, null, 2)}\n`;
    if (options.jsonOut) {
      const outputPath = resolve(options.jsonOut);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, serialized, "utf8");
    }
    process.stdout.write(serialized);
  } finally {
    await loaded.cleanup();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
