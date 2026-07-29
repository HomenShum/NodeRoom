import { describe, expect, it } from "vitest";
import {
  InMemoryRoomTools,
  MANAGED_LOCK_SYSTEM_PROMPT,
  PRODUCTION_ROOM_TOOLS,
  lastVersions,
  runAgent,
  scriptedModel,
  type AgentMessage,
} from "../src/nodeagent/index";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { RoomEngine } from "../src/engine/roomEngine";
import {
  cellEvidenceVerificationStatus,
  sealCellEvidence,
  TrustedSourceReceiptRegistry,
} from "../src/nodeagent/core/evidenceReceipt";
import {
  MAX_CELL_EVIDENCE_ITEMS,
  MAX_CELL_EVIDENCE_LABEL_CHARS,
  type CellEvidence,
} from "../src/engine/types";
import {
  mapWithManagedReviewConcurrency,
  MAX_MANAGED_EVIDENCE_REVIEW_CONCURRENCY,
} from "../src/nodeagent/skills/spreadsheet/cellMutator";

const TARGETS = { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" };

function setup() {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
  return { engine, d, rt };
}

async function attachTrustedNetworkSource(rt: InMemoryRoomTools) {
  const source = {
    ok: true as const,
    title: "Public investor update",
    url: "https://example.com/investor-update",
    snippet: "Exact public investor update evidence.",
    provenance: "network_fetch" as const,
  };
  const registry = new TrustedSourceReceiptRegistry();
  expect(await registry.recordFetchedSource({
    source,
    exactBytes: new TextEncoder().encode("<main>Exact public investor update evidence.</main>"),
  })).toBe(true);
  Object.defineProperty(rt, "resolveTrustedCellEvidenceReceipt", {
    configurable: true,
    value: (evidence: CellEvidence) => registry.resolve(evidence),
  });
  return source;
}

function parse(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function managedCommitted(messages: AgentMessage[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages) {
    if (m.role !== "tool" || (m.toolName !== "write_locked_cell" && m.toolName !== "write_locked_cells")) continue;
    const result = parse(m.content);
    if (!result?.ok && !result?.pendingApproval && !result?.drafted) continue;
    const call = messages
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.id === m.toolCallId);
    if (call?.args.elementId) out.add(String(call.args.elementId));
    const ops = call?.args.ops;
    if (Array.isArray(ops)) {
      for (const op of ops) {
        const elementId = (op as { elementId?: unknown }).elementId;
        if (elementId) out.add(String(elementId));
      }
    }
  }
  return out;
}

function managedVariancePlan(targets: Record<string, string>) {
  const ids = Object.keys(targets);
  return ({ messages }: { messages: AgentMessage[] }) => {
    const versions = lastVersions(messages);
    if (!ids.every((id) => versions[id] !== undefined)) {
      return { toolCalls: [{ tool: "read_range", args: { elementIds: ids } }] };
    }
    const committed = managedCommitted(messages);
    const missing = ids.filter((id) => !committed.has(id));
    if (missing.length) {
      return {
        toolCalls: [{
          tool: "write_locked_cells",
          args: {
            reason: "managed variance write",
            ops: missing.map((id) => ({ elementId: id, value: targets[id], baseVersion: versions[id] })),
          },
        }],
      };
    }
    return { say: "Variance cells written through managed locks.", done: true };
  };
}

describe("managed lock production tools", () => {
  it("hides explicit lock/unlock tools from the production bundle", () => {
    const names = PRODUCTION_ROOM_TOOLS.map((tool) => tool.name);

    expect(names).toContain("write_locked_cell");
    expect(names).toContain("write_locked_cells");
    expect(names).toContain("write_locked_cell_result");
    expect(names).toContain("write_locked_cell_results");
    expect(names).not.toContain("execute_verified_workbook_plan");
    expect(names).not.toContain("propose_lock");
    expect(names).not.toContain("release_lock");
    expect(names).not.toContain("create_draft");
  });

  it("lets the runtime acquire and release locks around writes without model-visible lock calls", async () => {
    const { engine, d, rt } = setup();
    const originalEdit = rt.editCell.bind(rt);
    let humanBlocked = false;

    rt.editCell = async (...args) => {
      if (!humanBlocked) {
        const version = engine.getArtifact(d.sheetId)!.elements.r_rev__variance.version;
        const attempted = engine.applyEdit({
          roomId: d.roomId,
          op: {
            opId: "human-during-managed-write",
            artifactId: d.sheetId,
            elementId: "r_rev__variance",
            kind: "set",
            value: "+19%",
            baseVersion: version,
          },
          actor: d.members.priya,
        });
        humanBlocked = !attempted.ok && attempted.reason === "locked";
      }
      return originalEdit(...args);
    };

    const result = await runAgent({
      rt,
      goal: "write two variance cells with runtime-managed locks",
      model: scriptedModel(managedVariancePlan(TARGETS), "managed-lock-scripted"),
      tools: PRODUCTION_ROOM_TOOLS,
      systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
      maxSteps: 5,
    });
    const art = engine.getArtifact(d.sheetId)!;

    expect(result.exhausted).toBe(false);
    expect(result.trace.map((event) => event.tool)).toEqual(["read_range", "write_locked_cells"]);
    expect(result.trace.some((event) => event.tool === "propose_lock" || event.tool === "release_lock")).toBe(false);
    expect(humanBlocked).toBe(true);
    expect(art.elements.r_rev__variance.value).toBe("+24%");
    expect(art.elements.r_cogs__variance.value).toBe("+27.5%");
    expect(engine.lockFor(d.sheetId, "r_rev__variance")).toBeUndefined();
  });

  it("normalizes cheap-model parallel arrays into managed scalar batch ops", async () => {
    const { engine, d, rt } = setup();
    const ids = Object.keys(TARGETS) as Array<keyof typeof TARGETS>;

    const result = await runAgent({
      rt,
      goal: "write two variance cells with a cheap-model batch shape",
      model: scriptedModel(({ messages }) => {
        const versions = lastVersions(messages);
        if (!ids.every((id) => versions[id] !== undefined)) {
          return { toolCalls: [{ tool: "read_range", args: { elementIds: ids } }] };
        }
        if (!messages.some((message) => message.role === "tool" && message.toolName === "write_locked_cells")) {
          return {
            toolCalls: [{
              tool: "write_locked_cells",
              args: {
                reason: "parallel array managed variance write",
                elementIds: JSON.stringify(ids),
                values: JSON.stringify(ids.map((id) => TARGETS[id])),
                baseVersions: JSON.stringify(ids.map((id) => versions[id])),
              },
            }],
          };
        }
        return { say: "Variance cells written through normalized managed locks.", done: true };
      }, "parallel-array-scripted"),
      tools: PRODUCTION_ROOM_TOOLS,
      systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
      maxSteps: 4,
    });
    const art = engine.getArtifact(d.sheetId)!;
    const writeResult = result.trace.find((event) => event.tool === "write_locked_cells")?.result as { ok?: boolean } | undefined;

    expect(result.trace.map((event) => event.tool)).toEqual(["read_range", "write_locked_cells"]);
    expect(writeResult).toMatchObject({ ok: true });
    expect(art.elements.r_rev__variance.value).toBe("+24%");
    expect(art.elements.r_cogs__variance.value).toBe("+27.5%");
  });

  it("normalizes cellId aliases and fills missing base versions in scalar batch ops", async () => {
    const { engine, d, rt } = setup();
    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cells")!;
    const parsed = writeLocked.schema.parse({
      reason: "cellId alias write",
      ops: JSON.stringify([
        { cellId: "r_rev__variance", value: "+24%" },
        { cellId: "r_cogs__variance", value: "+27.5%" },
      ]),
    });

    const result = await writeLocked.execute(parsed, rt) as { ok?: boolean; results?: Array<{ ok?: boolean }> };

    expect(result.ok).toBe(true);
    expect(result.results?.every((entry) => entry.ok)).toBe(true);
    expect(engine.getArtifact(d.sheetId)!.elements.r_rev__variance.value).toBe("+24%");
    expect(engine.getArtifact(d.sheetId)!.elements.r_cogs__variance.value).toBe("+27.5%");
  });

  it("fences every target version after locking before the first batch commit", async () => {
    const { engine, d, rt } = setup();
    const ids = Object.keys(TARGETS) as Array<keyof typeof TARGETS>;
    const cells = await rt.readRange(ids);
    const versions = Object.fromEntries(cells.map((cell) => [cell.id, cell.version]));
    const originalPropose = rt.proposeLock.bind(rt);
    rt.proposeLock = async (...args) => {
      const staleTarget = engine.getArtifact(d.sheetId)!.elements.r_cogs__variance;
      const raced = engine.applyEdit({
        roomId: d.roomId,
        op: {
          opId: "human-before-batch-lock",
          artifactId: d.sheetId,
          elementId: "r_cogs__variance",
          kind: "set",
          value: "+19%",
          baseVersion: staleTarget.version,
        },
        actor: d.members.priya,
      });
      expect(raced.ok).toBe(true);
      return originalPropose(...args);
    };
    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cells")!;

    const result = await writeLocked.execute({
      reason: "all-target CAS fence",
      ops: ids.map((id) => ({ elementId: id, value: TARGETS[id], baseVersion: versions[id] })),
    }, rt) as {
      ok?: boolean;
      conflict?: boolean;
      results?: Array<{ elementId?: string; conflict?: boolean }>;
      coordination?: { committedCount?: number; fence?: string; released?: boolean };
    };

    expect(result).toMatchObject({
      ok: false,
      conflict: true,
      coordination: {
        committedCount: 0,
        fence: "all_target_versions_before_first_write",
        released: true,
      },
    });
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ elementId: "r_cogs__variance", conflict: true }),
    ]));
    expect(engine.getArtifact(d.sheetId)!.elements.r_rev__variance.value).toBe("");
    expect(engine.getArtifact(d.sheetId)!.elements.r_cogs__variance.value).toBe("+19%");
  });

  it("normalizes cheap-model parallel arrays but holds manual-only claims for review", async () => {
    const { engine, d, rt } = setup();
    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_results")!;
    const parsed = writeLocked.schema.parse({
      reason: "parallel evidence write",
      elementIds: "[\"r_rev__variance\"]",
      values: "[\"11 months\"]",
      status: "complete",
      confidence: "0.82",
      evidence: "[{\"kind\":\"manual\",\"label\":\"Existing diligence note\"}]",
    });

    const result = await writeLocked.execute(parsed, rt) as { ok?: boolean };
    const value = engine.getArtifact(d.sheetId)!.elements.r_rev__variance.value as {
      value?: unknown;
      status?: string;
      confidence?: number;
      evidence?: Array<{ kind: string; label: string }>;
    };

    expect(result.ok).toBe(true);
    expect(value).toMatchObject({
      value: "11 months",
      status: "needs_review",
      confidence: 0.82,
      evidence: [{ kind: "manual", label: "Existing diligence note" }],
    });
  });

  it("downgrades a complete managed write when citation metadata has no trusted byte receipt", async () => {
    const { engine, d, rt } = setup();
    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_result")!;
    const parsed = writeLocked.schema.parse({
      elementId: "r_rev__variance",
      value: "11 months of runway",
      baseVersion: 1,
      status: "complete",
      confidence: 0.91,
      evidence: [{
        id: "model-fabricated-citation",
        kind: "source",
        label: "Model-provided investor update",
        url: "https://example.com/investor-update",
        snippet: "Claims 11 months of runway.",
        verifiedAt: Date.now() + 365 * 24 * 60 * 60 * 1_000,
        contentDigest: `sha256:${"a".repeat(64)}`,
        receiptDigest: "caller-forged-receipt",
      }],
    });

    const result = await writeLocked.execute(parsed, rt) as { ok?: boolean };
    const value = engine.getArtifact(d.sheetId)!.elements.r_rev__variance.value as {
      status?: string;
      evidence?: Array<{
        verifiedAt?: number;
        contentDigest?: string;
        receiptDigest?: string;
      }>;
    };

    expect(result.ok).toBe(true);
    expect(value.status).toBe("needs_review");
    expect(value.evidence).toHaveLength(1);
    expect(value.evidence?.[0]).not.toHaveProperty("verifiedAt");
    expect(value.evidence?.[0]).not.toHaveProperty("contentDigest");
    expect(value.evidence?.[0]).not.toHaveProperty("receiptDigest");
    expect(cellEvidenceVerificationStatus(value.evidence![0] as never)).toBe("unverified");
  });

  it("seals a complete managed write only after the same runtime fetched the exact citation presentation", async () => {
    const { engine, d, rt } = setup();
    const fetched = await attachTrustedNetworkSource(rt);
    expect(fetched).not.toHaveProperty("contentDigest");
    expect(fetched).not.toHaveProperty("verifiedAt");
    expect(fetched).not.toHaveProperty("receiptDigest");

    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_result")!;
    const parsed = writeLocked.schema.parse({
      elementId: "r_rev__variance",
      value: "11 months of runway",
      baseVersion: 1,
      status: "complete",
      confidence: 0.91,
      evidence: [{
        kind: "source",
        label: fetched.title,
        url: fetched.url,
        source: fetched.url,
        snippet: fetched.snippet,
      }],
    });

    const result = await writeLocked.execute(parsed, rt) as { ok?: boolean };
    const value = engine.getArtifact(d.sheetId)!.elements.r_rev__variance.value as {
      status?: string;
      evidence?: Array<{
        verifiedAt?: number;
        contentDigest?: string;
        receiptDigest?: string;
      }>;
    };

    expect(result.ok).toBe(true);
    expect(value.status).toBe("complete");
    expect(value.evidence?.[0]?.contentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(cellEvidenceVerificationStatus(value.evidence![0] as never)).toBe("verified");
  });

  it("keeps a mixed trusted and fabricated source set in review", async () => {
    const { engine, d, rt } = setup();
    const fetched = await attachTrustedNetworkSource(rt);
    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_result")!;
    const parsed = writeLocked.schema.parse({
      elementId: "r_rev__variance",
      value: "11 months of runway",
      baseVersion: 1,
      status: "complete",
      confidence: 0.91,
      evidence: [
        {
          kind: "source",
          label: fetched.title,
          url: fetched.url,
          source: fetched.url,
          snippet: fetched.snippet,
        },
        {
          kind: "source",
          label: "Fabricated second citation",
          url: "https://unfetched.example/source",
          snippet: "This presentation was never fetched by the runtime.",
        },
      ],
    });

    const result = await writeLocked.execute(parsed, rt) as { ok?: boolean };
    const value = engine.getArtifact(d.sheetId)!.elements.r_rev__variance.value as {
      status?: string;
      evidence?: Array<Record<string, unknown>>;
    };

    expect(result.ok).toBe(true);
    expect(value.status).toBe("needs_review");
    expect(value.evidence).toHaveLength(2);
    expect(cellEvidenceVerificationStatus(value.evidence![0] as never)).toBe("verified");
    expect(cellEvidenceVerificationStatus(value.evidence![1] as never)).toBe("unverified");
  });

  it.each([
    {
      name: "omitted snippet",
      mutate: (fetched: { title: string; url: string; snippet: string }) => ({
        label: fetched.title,
        url: fetched.url,
      }),
    },
    {
      name: "mutated snippet",
      mutate: (fetched: { title: string; url: string; snippet: string }) => ({
        label: fetched.title,
        url: fetched.url,
        snippet: `${fetched.snippet} forged`,
      }),
    },
    {
      name: "mutated title",
      mutate: (fetched: { title: string; url: string; snippet: string }) => ({
        label: `${fetched.title} forged`,
        url: fetched.url,
        snippet: fetched.snippet,
      }),
    },
    {
      name: "mutated URL",
      mutate: (fetched: { title: string; url: string; snippet: string }) => ({
        label: fetched.title,
        url: `${fetched.url}other`,
        snippet: fetched.snippet,
      }),
    },
  ])("keeps a fetched citation unverified when the model submits $name", async ({ mutate }) => {
    const { engine, d, rt } = setup();
    const fetched = await attachTrustedNetworkSource(rt);
    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_result")!;
    const parsed = writeLocked.schema.parse({
      elementId: "r_rev__variance",
      value: "11 months of runway",
      baseVersion: 1,
      status: "complete",
      confidence: 0.91,
      evidence: [{ kind: "source", ...mutate(fetched) }],
    });

    const result = await writeLocked.execute(parsed, rt) as { ok?: boolean };
    const value = engine.getArtifact(d.sheetId)!.elements.r_rev__variance.value as {
      status?: string;
      evidence?: Array<Record<string, unknown>>;
    };

    expect(result.ok).toBe(true);
    expect(value.status).toBe("needs_review");
    expect(value.evidence?.[0]).not.toHaveProperty("receiptDigest");
  });

  it("fails closed when a RoomTools adapter has no same-runtime receipt registry", async () => {
    const { engine, d, rt } = setup();
    const fetched = await rt.fetchSource("https://example.com/investor-update");
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) throw new Error(fetched.error);
    expect(fetched.provenance).toBe("synthetic_fixture");
    Object.defineProperty(rt, "resolveTrustedCellEvidenceReceipt", {
      configurable: true,
      value: undefined,
    });
    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_result")!;
    const parsed = writeLocked.schema.parse({
      elementId: "r_rev__variance",
      value: "11 months of runway",
      baseVersion: 1,
      status: "complete",
      confidence: 0.91,
      evidence: [{
        kind: "source",
        label: fetched.title,
        url: fetched.url,
        snippet: fetched.snippet,
      }],
    });

    const result = await writeLocked.execute(parsed, rt) as { ok?: boolean };
    const value = engine.getArtifact(d.sheetId)!.elements.r_rev__variance.value as {
      status?: string;
    };

    expect(result.ok).toBe(true);
    expect(value.status).toBe("needs_review");
  });

  it("normalizes single-string elementIds for read_range", async () => {
    const { rt } = setup();
    const readRange = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "read_range")!;

    const readArgs = readRange.schema.parse({ elementIds: "r_rev__variance" });
    const [cell] = await readRange.execute(readArgs, rt) as Array<{ id: string }>;
    expect(cell.id).toBe("r_rev__variance");
  });

  it("accepts omitted elementIds for read_range so the backend can return guidance", async () => {
    const readRange = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "read_range")!;

    const readArgs = readRange.schema.parse({ artifactId: "source-workbook" });

    expect(readArgs).toMatchObject({ artifactId: "source-workbook", elementIds: [] });
  });

  it("drafts instead of writing when another actor already owns the target lock", async () => {
    const { engine, d } = setup();
    const held = engine.proposeLock({
      roomId: d.roomId,
      artifactId: d.sheetId,
      elementIds: ["r_rev__variance"],
      holder: d.agents.room,
      sessionId: d.sessions.room,
      reason: "public agent owns the cell",
    });
    expect(held.ok).toBe(true);
    const rtB = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.priv, d.sessions.priv);
    const [cell] = await rtB.readRange(["r_rev__variance"]);
    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell")!;

    const result = await writeLocked.execute({
      elementId: "r_rev__variance",
      value: "+24%",
      baseVersion: cell.version,
      reason: "private managed write",
    }, rtB) as { drafted?: boolean; draftId?: string };

    expect(result.drafted).toBe(true);
    expect(result.draftId).toMatch(/^draft_/);
    expect(engine.getArtifact(d.sheetId)!.elements.r_rev__variance.value).toBe("");

    if (held.ok) engine.releaseLock(held.lock.id, d.agents.room);
    expect(engine.getArtifact(d.sheetId)!.elements.r_rev__variance.value).toBe("+24%");
  });

  it("skips unchanged scalar writes before acquiring a managed lock", async () => {
    const { rt } = setup();
    const [cell] = await rt.readRange(["r_rev__variance"]);
    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell")!;
    const originalPropose = rt.proposeLock.bind(rt);
    let lockCalls = 0;
    rt.proposeLock = async (...args) => {
      lockCalls++;
      return originalPropose(...args);
    };

    const result = await writeLocked.execute({
      elementId: "r_rev__variance",
      value: cell.value,
      baseVersion: 999,
      reason: "repeat unchanged write",
    }, rt) as { ok?: boolean; skipped?: boolean; reason?: string; version?: number };

    expect(result).toMatchObject({ ok: true, skipped: true, reason: "unchanged", version: cell.version });
    expect(lockCalls).toBe(0);
  });

  it("skips unchanged evidence-bearing batch writes before acquiring a managed lock", async () => {
    const { engine, d, rt } = setup();
    const payload = {
      value: "11 months",
      status: "needs_review",
      confidence: 0.82,
      evidence: [sealCellEvidence({
        id: "manual:r_rev__variance:1",
        kind: "manual",
        label: "Existing diligence note",
      })],
    };
    const art = engine.getArtifact(d.sheetId)!;
    const seeded = engine.applyEdit({
      roomId: d.roomId,
      op: {
        opId: "seed-evidence-payload",
        artifactId: d.sheetId,
        elementId: "r_rev__variance",
        kind: "set",
        value: payload,
        baseVersion: art.elements.r_rev__variance.version,
      },
      actor: d.members.homen,
    });
    expect(seeded.ok).toBe(true);
    const [cell] = await rt.readRange(["r_rev__variance"]);
    const writeLocked = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_results")!;
    const originalPropose = rt.proposeLock.bind(rt);
    let lockCalls = 0;
    rt.proposeLock = async (...args) => {
      lockCalls++;
      return originalPropose(...args);
    };

    const result = await writeLocked.execute({
      reason: "repeat unchanged evidence write",
      ops: [{
        elementId: "r_rev__variance",
        value: "11 months",
        baseVersion: cell.version,
        status: "complete",
        confidence: 0.82,
        evidence: [{ kind: "manual", label: "Existing diligence note" }],
      }],
    }, rt) as { ok?: boolean; skipped?: boolean; reason?: string; results?: Array<{ skipped?: boolean; version?: number }> };

    expect(result).toMatchObject({ ok: true, skipped: true, reason: "unchanged" });
    expect(result.results?.[0]).toMatchObject({ skipped: true, version: cell.version });
    expect(lockCalls).toBe(0);
  });

  it("rejects an analyst's oversized direct and parallel evidence before any lock or write is attempted", async () => {
    const { rt } = setup();
    const writeSingle = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_result")!;
    const writeBatch = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_results")!;
    const oversizedEvidence = Array.from({ length: MAX_CELL_EVIDENCE_ITEMS + 1 }, (_, index) => ({
      kind: "manual" as const,
      label: `Review note ${index + 1}`,
    }));

    expect(writeSingle.schema.safeParse({
      elementId: "r_rev__variance",
      value: "bounded claim",
      baseVersion: 1,
      status: "needs_review",
      evidence: oversizedEvidence,
    }).success).toBe(false);
    expect(writeSingle.schema.safeParse({
      elementId: "r_rev__variance",
      value: "bounded claim",
      baseVersion: 1,
      status: "needs_review",
      evidence: [{
        kind: "manual",
        label: "x".repeat(MAX_CELL_EVIDENCE_LABEL_CHARS + 1),
      }],
    }).success).toBe(false);

    const parallel = writeBatch.schema.parse({
      elementIds: ["r_rev__variance"],
      values: ["bounded claim"],
      statuses: ["needs_review"],
      evidences: [oversizedEvidence],
    });
    const originalPropose = rt.proposeLock.bind(rt);
    let lockCalls = 0;
    rt.proposeLock = async (...args) => {
      lockCalls += 1;
      return originalPropose(...args);
    };

    await expect(writeBatch.execute(parallel, rt)).rejects.toThrow();
    expect(lockCalls).toBe(0);
  });

  it("rejects a 2,049-cell burst in explicit and cheap-model parallel shapes", () => {
    const writeBatch = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_results")!;
    const ops = Array.from({ length: 2_049 }, (_, index) => ({
      elementId: `row_${index}__summary`,
      value: `value ${index}`,
      baseVersion: 1,
      status: "needs_review",
      evidence: [{ kind: "manual", label: `Review note ${index}` }],
    }));

    expect(writeBatch.schema.safeParse({ ops }).success).toBe(false);
    expect(writeBatch.schema.safeParse({
      elementIds: ops.map((op) => op.elementId),
      values: ops.map((op) => op.value),
      baseVersions: ops.map((op) => op.baseVersion),
      statuses: ops.map((op) => op.status),
      evidences: ops.map((op) => op.evidence),
    }).success).toBe(false);
  });

  it("bounds evidence review fan-out for both a burst and sustained analyst batches", async () => {
    let inFlight = 0;
    let peakInFlight = 0;

    for (let wave = 0; wave < 4; wave += 1) {
      const items = Array.from({ length: MAX_MANAGED_EVIDENCE_REVIEW_CONCURRENCY * 3 + 1 }, (_, index) =>
        wave * 100 + index);
      const reviewed = await mapWithManagedReviewConcurrency(items, async (item) => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return item * 2;
      });

      expect(reviewed).toEqual(items.map((item) => item * 2));
      expect(inFlight).toBe(0);
      expect(peakInFlight).toBeLessThanOrEqual(MAX_MANAGED_EVIDENCE_REVIEW_CONCURRENCY);
    }

    expect(peakInFlight).toBe(MAX_MANAGED_EVIDENCE_REVIEW_CONCURRENCY);
  });
});
