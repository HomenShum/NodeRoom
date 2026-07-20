import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

interface PortablePrincipal {
  userId: string;
  organizationId?: string;
  roles: readonly string[];
  permissions: readonly string[];
}

type PortableAuthorizationAction =
  | "deck.read"
  | "patch.apply"
  | "proposal.create"
  | "proposal.accept"
  | "proposal.reject"
  | "versions.list"
  | "receipt.store";

interface PortableAuthorizationEvidence {
  issuer: string;
  policyId: string;
  policyVersion: string;
  evidenceId: string;
}

type PortableAuthorizationRequest =
  | { action: "deck.read"; deckId: string; principal: PortablePrincipal }
  | {
      action: "patch.apply" | "proposal.create";
      deckId: string;
      principal: PortablePrincipal;
      patch: Readonly<PortablePatchCommand>;
    }
  | {
      action: "proposal.accept" | "proposal.reject";
      deckId: string;
      principal: PortablePrincipal;
      proposalId: string;
    }
  | {
      action: "versions.list";
      deckId: string;
      principal: PortablePrincipal;
      limit?: number;
    }
  | {
      action: "receipt.store";
      deckId: string;
      principal: PortablePrincipal;
      receipt: Readonly<PortableReceiptDraft>;
    };

interface PortableAuthorizationReceipt {
  schemaVersion: "nodeslide.authorization/v1";
  id: string;
  principalId: string;
  organizationId?: string;
  deckId: string;
  action: PortableAuthorizationAction;
  resource: {
    kind: "deck" | "patch" | "proposal" | "receipt";
    id: string;
  };
  authorizedAt: number;
  evidence: PortableAuthorizationEvidence;
}

interface PortableReceiptDraft {
  id: `custom-receipt:${string}`;
  deckId: string;
  deckVersion: number;
  operation: "custom";
  patchId?: string;
  traceId?: string;
  recordedAt: number;
  attributes: Record<string, unknown>;
}

interface PortableReceipt {
  id: string;
  deckId: string;
  operation: string;
  deckVersion: number;
  principalId: string;
  patchId?: string;
  traceId?: string;
  authorization: PortableAuthorizationReceipt;
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

interface PortableApplyPatchResult {
  snapshot: PortableDeckSnapshot;
  receipt: PortableReceipt;
}

interface PortableRepository {
  getDeck(input: JsonRecord): Promise<PortableDeckSnapshot | null>;
  applyPatch(input: JsonRecord): Promise<PortableApplyPatchResult>;
  createProposal(input: JsonRecord): Promise<PortableProposal>;
  resolveProposal(input: JsonRecord): Promise<PortableResolution>;
  listVersions(input: JsonRecord): Promise<Array<{ version: number }>>;
  storeReceipt(input: JsonRecord): Promise<PortableReceipt>;
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
      request: Readonly<PortableAuthorizationRequest>,
    ) => PortableAuthorizationEvidence | Promise<PortableAuthorizationEvidence>;
  }) => PortableRepository;
  createNodeSlideTestSnapshot(
    deckId?: string,
    timestamp?: number,
  ): PortableDeckSnapshot;
  createNodeSlideTextPatch(
    snapshot: PortableDeckSnapshot,
    text: string,
    id?: string,
  ): PortablePatchCommand;
  runNodeSlideRepositoryConformance(input: {
    repository: PortableRepository;
    principal: PortablePrincipal;
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
  if (!condition)
    throw new Error(`NodeSlide consumer proof failed: ${message}`);
}

function authorizationResourceId(
  request: PortableAuthorizationRequest,
): string {
  switch (request.action) {
    case "patch.apply":
    case "proposal.create":
      return request.patch.id;
    case "proposal.accept":
    case "proposal.reject":
      return request.proposalId;
    case "receipt.store":
      return request.receipt.id;
    case "deck.read":
    case "versions.list":
      return request.deckId;
  }
}

function authorizationResourceKind(
  action: PortableAuthorizationAction,
): PortableAuthorizationReceipt["resource"]["kind"] {
  switch (action) {
    case "patch.apply":
      return "patch";
    case "proposal.create":
    case "proposal.accept":
    case "proposal.reject":
      return "proposal";
    case "receipt.store":
      return "receipt";
    case "deck.read":
    case "versions.list":
      return "deck";
  }
}

function assertAuthorizationBinding(
  receipt: PortableReceipt,
  expected: {
    action: PortableAuthorizationAction;
    deckId: string;
    principalId: string;
    resourceId: string;
  },
): void {
  const authorization = receipt.authorization;
  assert(
    authorization?.schemaVersion === "nodeslide.authorization/v1",
    `${receipt.operation} receipt lacks the authorization schema version.`,
  );
  assert(
    authorization.principalId === expected.principalId &&
      receipt.principalId === expected.principalId,
    `${receipt.operation} receipt is not bound to the host principal.`,
  );
  assert(
    authorization.deckId === expected.deckId &&
      receipt.deckId === expected.deckId,
    `${receipt.operation} receipt is not bound to the requested deck.`,
  );
  assert(
    authorization.action === expected.action &&
      authorization.resource.kind ===
        authorizationResourceKind(expected.action) &&
      authorization.resource.id === expected.resourceId,
    `${receipt.operation} receipt is not bound to the authorized operation resource.`,
  );
  assert(
    authorization.evidence.issuer === "NodeRoom" &&
      authorization.evidence.policyId === "noderoom.actor-proof-membership" &&
      authorization.evidence.policyVersion === "1" &&
      authorization.evidence.evidenceId ===
        `noderoom-authz:${expected.action}:${expected.resourceId}`,
    `${receipt.operation} receipt lost its host authorization evidence.`,
  );
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
  assert(
    typeof parsed.name === "string",
    `${packageJsonPath} has no package name.`,
  );
  assert(
    typeof parsed.version === "string",
    `${packageJsonPath} has no package version.`,
  );
  return { name: parsed.name, version: parsed.version };
}

function validateTestingModule(
  value: unknown,
): asserts value is NodeSlideTestingModule {
  assert(
    typeof value === "object" && value !== null,
    "testing entrypoint is not a module.",
  );
  const module = value as Record<string, unknown>;
  for (const exportName of [
    "MemoryNodeSlideRepository",
    "createNodeSlideTestSnapshot",
    "createNodeSlideTextPatch",
    "runNodeSlideRepositoryConformance",
  ]) {
    assert(
      typeof module[exportName] === "function",
      `testing package lacks ${exportName}.`,
    );
  }
}

async function importTestingModule(
  entrypoint: string,
): Promise<NodeSlideTestingModule> {
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
  assert(
    existsSync(packageJsonPath),
    `${root} is not a NodeSlide package workspace.`,
  );
  const identity = await readPackageIdentity(packageJsonPath);
  assert(
    identity.name === "@nodeslide/testing",
    `${root} does not contain @nodeslide/testing.`,
  );
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

async function loadFromPackedArtifact(
  artifactInput: string,
): Promise<LoadedTestingModule> {
  const artifacts = await resolveNodeSlidePackedArtifacts(artifactInput);
  const artifact = artifacts.testingArtifact;
  const integritySha256 = createHash("sha256")
    .update(await readFile(artifact))
    .digest("hex");
  const temporaryRoot = resolve(tmpdir());
  const installRoot = await mkdtemp(
    join(temporaryRoot, "noderoom-nodeslide-consumer-"),
  );
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
    const packageRoot = join(
      installRoot,
      "node_modules",
      "@nodeslide",
      "testing",
    );
    const packageJsonPath = join(packageRoot, "package.json");
    const entrypoint = join(packageRoot, "dist", "index.js");
    assert(
      existsSync(entrypoint),
      `${artifact} did not install a testing entrypoint.`,
    );
    const identity = await readPackageIdentity(packageJsonPath);
    assert(
      identity.name === "@nodeslide/testing",
      `${artifact} is not @nodeslide/testing.`,
    );
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
  assert(
    !(root && artifact),
    "provide NODESLIDE_ROOT or a packed artifact, not both.",
  );
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
    actor: {
      kind: "user",
      id: "user:noderoom-consumer",
      name: "NodeRoom consumer",
    },
    membershipRole: "host",
    hostAuthVerified: true,
    allowDeckWrites: true,
  });
  const authChecks: Array<{
    action: PortableAuthorizationAction;
    deckId: string;
    resourceId: string;
  }> = [];
  const authorize = (
    ...authorizationArgs: [Readonly<PortableAuthorizationRequest>]
  ): PortableAuthorizationEvidence => {
    assert(
      authorizationArgs.length === 1,
      "repository authorizer did not receive exactly one request.",
    );
    const [request] = authorizationArgs;
    assert(
      Object.isFrozen(request),
      "repository authorization request was not frozen.",
    );
    assert(
      Object.isFrozen(request.principal),
      "authorization principal was not frozen.",
    );
    assert(
      Object.isFrozen(request.principal.roles) &&
        Object.isFrozen(request.principal.permissions),
      "authorization principal claims were not frozen.",
    );
    if (
      request.action === "patch.apply" ||
      request.action === "proposal.create"
    ) {
      assert(
        Object.isFrozen(request.patch),
        `${request.action} patch was not frozen.`,
      );
      assert(
        Object.isFrozen(request.patch.operations),
        `${request.action} operations were not frozen.`,
      );
    }
    if (request.action === "receipt.store") {
      assert(
        Object.isFrozen(request.receipt),
        "receipt.store draft was not frozen.",
      );
      assert(
        Object.isFrozen(request.receipt.attributes),
        "receipt.store attributes were not frozen.",
      );
    }
    assert(
      request.principal.userId === principal.userId,
      "repository accepted another principal.",
    );
    const requiredPermission =
      request.action === "deck.read" || request.action === "versions.list"
        ? "nodeslide:read"
        : request.action === "proposal.create"
          ? "nodeslide:propose"
          : "nodeslide:write";
    assert(
      request.principal.permissions.includes(requiredPermission),
      `host principal lacks ${requiredPermission}.`,
    );
    const resourceId = authorizationResourceId(request);
    authChecks.push({
      action: request.action,
      deckId: request.deckId,
      resourceId,
    });
    return {
      issuer: "NodeRoom",
      policyId: "noderoom.actor-proof-membership",
      policyVersion: "1",
      evidenceId: `noderoom-authz:${request.action}:${resourceId}`,
    };
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
  assert(
    conformance.proposalVersion === 1,
    "proposal mutated the authoritative deck.",
  );
  assert(
    conformance.acceptedVersion === 2,
    "acceptance did not advance the deck to v2.",
  );
  assert(
    conformance.resolution.status === "accepted",
    "current proposal was not accepted.",
  );
  assert(
    conformance.resolution.receipt.traceId === conformancePatch.traceId,
    "acceptance receipt lost its trace binding.",
  );
  assertAuthorizationBinding(conformance.resolution.receipt, {
    action: "proposal.accept",
    deckId: conformanceSnapshot.deck.id,
    principalId: principal.userId,
    resourceId: conformancePatch.id,
  });

  const authorizationSnapshot = runtime.createNodeSlideTestSnapshot(
    "deck:noderoom:authorization",
    1_700_000_000_025,
  );
  const authorizationRepository = new runtime.MemoryNodeSlideRepository({
    snapshots: [authorizationSnapshot],
    now,
    authorize,
  });
  const directCommand = runtime.createNodeSlideTextPatch(
    authorizationSnapshot,
    "Applied through the authorized direct path",
    "patch:noderoom:direct",
  );
  directCommand.traceId = "trace:noderoom:direct";
  const direct = await authorizationRepository.applyPatch({
    deckId: authorizationSnapshot.deck.id,
    principal,
    patch: directCommand,
  });
  assert(
    direct.snapshot.deck.version === 2,
    "authorized direct patch did not create v2.",
  );
  assert(
    direct.receipt.operation === "patch.applied" &&
      direct.receipt.traceId === directCommand.traceId,
    "direct patch receipt is incomplete.",
  );
  assertAuthorizationBinding(direct.receipt, {
    action: "patch.apply",
    deckId: authorizationSnapshot.deck.id,
    principalId: principal.userId,
    resourceId: directCommand.id,
  });

  const rejectedCommand = runtime.createNodeSlideTextPatch(
    direct.snapshot,
    "Rejected through the authorized review path",
    "patch:noderoom:rejected",
  );
  rejectedCommand.traceId = "trace:noderoom:rejected";
  const rejectedProposal = await authorizationRepository.createProposal({
    deckId: authorizationSnapshot.deck.id,
    principal,
    patch: rejectedCommand,
  });
  const rejected = await authorizationRepository.resolveProposal({
    deckId: authorizationSnapshot.deck.id,
    principal,
    proposalId: rejectedProposal.id,
    decision: "reject",
  });
  assert(
    rejected.status === "rejected",
    "authorized proposal rejection did not persist.",
  );
  assert(
    rejected.snapshot.deck.version === direct.snapshot.deck.version,
    "proposal rejection changed the authoritative deck.",
  );
  assertAuthorizationBinding(rejected.receipt, {
    action: "proposal.reject",
    deckId: authorizationSnapshot.deck.id,
    principalId: principal.userId,
    resourceId: rejectedProposal.id,
  });

  const customReceiptDraft: PortableReceiptDraft = {
    id: "custom-receipt:noderoom:consumer-audit",
    deckId: authorizationSnapshot.deck.id,
    deckVersion: direct.snapshot.deck.version,
    operation: "custom",
    traceId: "trace:noderoom:consumer-audit",
    recordedAt: now(),
    attributes: { purpose: "cross-repository-authorization-proof" },
  };
  const storedAuditReceipt = await authorizationRepository.storeReceipt({
    deckId: authorizationSnapshot.deck.id,
    principal,
    receipt: customReceiptDraft,
  });
  assertAuthorizationBinding(storedAuditReceipt, {
    action: "receipt.store",
    deckId: authorizationSnapshot.deck.id,
    principalId: principal.userId,
    resourceId: customReceiptDraft.id,
  });
  const authorizationVersions = await authorizationRepository.listVersions({
    deckId: authorizationSnapshot.deck.id,
    principal,
    limit: 2,
  });
  assert(
    authorizationVersions
      .map((version) => version.version)
      .sort()
      .join(",") === "1,2",
    "authorized direct path did not preserve exactly v1 -> v2.",
  );
  const authorizationReload = await authorizationRepository.getDeck({
    deckId: authorizationSnapshot.deck.id,
    principal,
  });
  assert(
    authorizationReload?.elements[0]?.content ===
      "Applied through the authorized direct path",
    "authorized direct patch did not survive repository reload.",
  );
  const authorizationReceipts =
    authorizationRepository.receiptsForDeck?.(authorizationSnapshot.deck.id) ??
    [];
  const rejectedProposalReceipt = authorizationReceipts.find(
    (receipt) =>
      receipt.operation === "proposal.created" &&
      receipt.patchId === rejectedProposal.id,
  );
  assert(
    rejectedProposalReceipt,
    "rejected proposal lacks its creation receipt.",
  );
  assertAuthorizationBinding(rejectedProposalReceipt, {
    action: "proposal.create",
    deckId: authorizationSnapshot.deck.id,
    principalId: principal.userId,
    resourceId: rejectedProposal.id,
  });

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
      assert(
        current,
        "NodeAgent deck snapshot was not found before proposal creation.",
      );
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
        description:
          "Create an unapplied NodeSlide text proposal for host review.",
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
          const outcome = await rt.applyDeckPatch({
            patch,
            expectedVersion: current.version,
          });
          await rt.say(
            "NodeAgent created a NodeSlide proposal for host review.",
          );
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
      return {
        text: "The deck proposal is ready for host review.",
        toolCalls: [],
        done: true,
      };
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
  assert(
    nodeAgentResult.stopReason === "done",
    "NodeAgent did not finish the proposal run.",
  );
  assert(
    nodeAgentResult.trace.length === 1,
    "NodeAgent did not execute exactly one deck tool.",
  );
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
  assert(
    pendingNodeAgentProposalId,
    "NodeAgent did not create a reviewable proposal.",
  );
  const nodeAgentAcceptance = await nodeAgentRepository.resolveProposal({
    deckId: nodeAgentSnapshot.deck.id,
    principal,
    proposalId: pendingNodeAgentProposalId,
    decision: "accept",
  });
  assert(
    nodeAgentAcceptance.status === "accepted",
    "host did not accept the NodeAgent proposal.",
  );
  assert(
    nodeAgentAcceptance.snapshot.deck.version === 2,
    "accepted NodeAgent proposal did not advance the deck to v2.",
  );
  assert(
    nodeAgentAcceptance.receipt.traceId === nodeAgentTraceId,
    "NodeAgent acceptance receipt lost its trace binding.",
  );
  assertAuthorizationBinding(nodeAgentAcceptance.receipt, {
    action: "proposal.accept",
    deckId: nodeAgentSnapshot.deck.id,
    principalId: principal.userId,
    resourceId: pendingNodeAgentProposalId,
  });
  const reloadedNodeAgentSnapshot = await nodeAgentRepository.getDeck({
    deckId: nodeAgentSnapshot.deck.id,
    principal,
  });
  assert(
    reloadedNodeAgentSnapshot?.elements[0]?.content ===
      "Proposed through NodeRoom NodeAgent",
    "accepted NodeAgent edit did not survive repository reload.",
  );
  const serializedNodeAgentSnapshot = JSON.stringify(reloadedNodeAgentSnapshot);
  const reopenedNodeAgentSnapshot = JSON.parse(
    serializedNodeAgentSnapshot,
  ) as PortableDeckSnapshot;
  assert(
    reopenedNodeAgentSnapshot.deck.version === 2 &&
      reopenedNodeAgentSnapshot.elements[0]?.content ===
        "Proposed through NodeRoom NodeAgent",
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
    acceptedProposal.operations.length > 0 &&
      staleProposal.operations.length > 0,
    "candidate review omitted proposed operations.",
  );
  const beforeDecision = await casRepository.getDeck({
    deckId: casSnapshot.deck.id,
    principal,
  });
  assert(
    beforeDecision?.deck.version === 1,
    "proposal creation changed canonical state.",
  );

  const accepted = await casRepository.resolveProposal({
    deckId: casSnapshot.deck.id,
    principal,
    proposalId: acceptedProposal.id,
    decision: "accept",
  });
  assert(accepted.status === "accepted", "reviewed proposal was not accepted.");
  assert(
    accepted.snapshot.deck.version === 2,
    "accepted proposal did not create v2.",
  );
  assert(
    accepted.snapshot.elements[0]?.content === "Accepted candidate",
    "accepted text was not applied.",
  );
  assert(
    accepted.receipt.operation === "proposal.accepted" &&
      accepted.receipt.traceId === acceptedCommand.traceId,
    "accepted proposal receipt is incomplete.",
  );
  assertAuthorizationBinding(accepted.receipt, {
    action: "proposal.accept",
    deckId: casSnapshot.deck.id,
    principalId: principal.userId,
    resourceId: acceptedProposal.id,
  });

  const stale = await casRepository.resolveProposal({
    deckId: casSnapshot.deck.id,
    principal,
    proposalId: staleProposal.id,
    decision: "accept",
  });
  assert(
    stale.status === "stale",
    "competing base-version proposal did not fail CAS.",
  );
  assert(
    stale.snapshot.deck.version === 2,
    "stale proposal changed canonical deck version.",
  );
  assert(
    stale.receipt.operation === "proposal.stale" &&
      stale.receipt.traceId === staleCommand.traceId,
    "stale proposal receipt is incomplete.",
  );
  assertAuthorizationBinding(stale.receipt, {
    action: "proposal.accept",
    deckId: casSnapshot.deck.id,
    principalId: principal.userId,
    resourceId: staleProposal.id,
  });

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
  assert(
    finalSnapshot?.deck.version === 2,
    "replayed acceptance advanced the version twice.",
  );
  assert(
    versions
      .map((version) => version.version)
      .sort()
      .join(",") === "1,2",
    "version history is not exactly v1 -> v2.",
  );
  const receipts = casRepository.receiptsForDeck?.(casSnapshot.deck.id) ?? [];
  const receiptOperations = receipts.map((receipt) => receipt.operation);
  for (const required of [
    "proposal.created",
    "proposal.accepted",
    "proposal.stale",
  ]) {
    assert(
      receiptOperations.includes(required),
      `receipt ledger lacks ${required}.`,
    );
  }
  const requiredAuthorizationActions = [
    "deck.read",
    "patch.apply",
    "proposal.create",
    "proposal.accept",
    "proposal.reject",
    "versions.list",
    "receipt.store",
  ] as const satisfies readonly PortableAuthorizationAction[];
  for (const action of requiredAuthorizationActions) {
    assert(
      authChecks.some((check) => check.action === action),
      `host authorizer was not called for ${action}.`,
    );
  }

  return {
    schemaVersion: "noderoom.nodeslide-consumer-proof/v2",
    passed: true,
    package: {
      name: loaded.packageName,
      version: loaded.packageVersion,
      inputKind: loaded.inputKind,
      ...(loaded.integritySha256
        ? { integritySha256: loaded.integritySha256 }
        : {}),
      entrypoint:
        loaded.inputKind === "repository-root"
          ? "packages/testing/dist/index.js"
          : "@nodeslide/testing/dist/index.js",
    },
    host: {
      application: "NodeRoom",
      runtimeChanged: false,
      authorizationMode: "deterministic-preverified-fixture",
      authAuthority:
        "preverified fixture; production ActorProof and room-membership policy not executed",
      actorProofValidated: false,
      roomMembershipValidated: false,
      productionPolicyExecuted: false,
      principalId: principal.userId,
      roles: principal.roles,
      permissions: principal.permissions,
      authorizationChecks: authChecks.length,
      authorizationActions: requiredAuthorizationActions,
      authorizationEvidence: {
        issuer: "NodeRoom",
        policyId: "noderoom.actor-proof-membership",
        policyVersion: "1",
      },
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
      acceptanceReplayWasIdempotent:
        acceptedAgain.receipt.id === accepted.receipt.id,
      authorizationSpine: {
        directPatchReceipt: direct.receipt,
        rejectedProposalStatus: rejected.status,
        rejectedProposalReceipt: rejected.receipt,
        storedAuditReceipt,
        authorizationReceiptOperations: authorizationReceipts.map(
          (receipt) => receipt.operation,
        ),
        frozenOperationRequests: true,
        allRepositoryActionsObserved: true,
      },
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
      fixtureAuthorizationEvidenceBinding: true,
      authorizationBoundReceipts: true,
      frozenOperationAuthorizationRequests: true,
      existingNodeAgentRuntime: true,
      agentProposalStayedUnapplied: true,
      reload: true,
      portableSnapshotRoundTrip: true,
      productionAuthorization: false,
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
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
