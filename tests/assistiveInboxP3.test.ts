// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";
import workflowSchema from "../node_modules/@convex-dev/workflow/dist/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/dist/component/schema.js";
import { scanActivityRow } from "../convex/roomActivity";

const modules = import.meta.glob("../convex/**/*.ts");
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/dist/component/**/*.js");
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/dist/component/**/*.js");
delete (modules as Record<string, unknown>)["../convex/agent.ts"];
delete (modules as Record<string, unknown>)["../convex/agentJobRunner.ts"];
delete (modules as Record<string, unknown>)["../convex/embeddingRunner.ts"];

const token = "0123456789abcdefghijklmnopqrstuvwxyzTOKEN";

async function setupRoom() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  const now = Date.now();
  const authTokenHash = await hashToken(token);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", {
      code: `T${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      title: "P3 Test Room",
      hostId: "",
      autoAllow: true,
      status: "live" as const,
      createdAt: now,
    }),
  );
  const memberId = await t.run((ctx) =>
    ctx.db.insert("members", {
      roomId,
      name: "Host",
      role: "host" as const,
      anon: false,
      color: "#111111",
      authTokenHash,
      lastSeenAt: now,
    }),
  );
  const actor = { kind: "user" as const, id: String(memberId), name: "Host" };
  await t.run((ctx) => ctx.db.patch(roomId, { hostId: String(memberId) }));
  await t.run((ctx) => ctx.db.insert("agentSessions", {
    roomId,
    agentId: "agent_room",
    agentName: "Room NodeAgent",
    scope: "public" as const,
    status: "idle" as const,
    lastAction: "started",
    updatedAt: now,
  }));
  return { t, proof: { actor, token }, actor, roomId };
}

async function seedNode(
  t: ReturnType<typeof convexTest>,
  roomId: Id<"rooms">,
  content: string,
): Promise<Id<"nodes">> {
  const now = Date.now();
  const notebookId = await t.run((ctx) =>
    ctx.db.insert("notebooks", {
      roomId,
      title: "Test Notebook",
      ownerId: "host",
      visibility: "room" as const,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const nodeId = await t.run((ctx) =>
    ctx.db.insert("nodes", {
      roomId,
      notebookId,
      authorId: "host",
      kind: "note" as const,
      title: "test note",
      content,
      contentFormat: "plain" as const,
      visibility: "room" as const,
      version: 1,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    }),
  );
  return nodeId;
}

async function seedOutboxRow(
  t: ReturnType<typeof convexTest>,
  roomId: Id<"rooms">,
  opts: {
    entityName?: string;
    entityKind?: string;
    signalKind?: string;
    sourceKind?: string;
    sourceId?: string;
    status?: string;
    score?: number;
    ageMs?: number;
  },
) {
  const now = Date.now();
  const ageMs = opts.ageMs ?? 0;
  const entityName = opts.entityName ?? "TestCo";
  const entityKey = entityName.toLowerCase().trim();
  const signalKind = opts.signalKind ?? "entity_mention";
  const sourceKind = opts.sourceKind ?? "node";
  const sourceId = opts.sourceId ?? "test-source";
  const score = opts.score ?? 0.8;
  const row = await t.run((ctx) =>
    ctx.db.insert("roomActivityOutbox", {
      roomId,
      sourceKind: sourceKind as any,
      sourceId,
      sourceHash: `hash_${entityName}_${Math.random()}`,
      eventKind: "cell_committed" as any,
      status: (opts.status ?? "queued") as any,
      visibility: "room" as const,
      ownerId: "host",
      actor: { kind: "user" as const, id: "host", name: "Host" },
      dedupeKey: `dedupe_${entityKey}_${Math.random()}`,
      quietUntil: now - ageMs,
      finding: {
        entities: [{
          type: opts.entityKind ?? "company",
          displayName: entityName,
          entityKey,
          confidence: score,
        }],
        signals: [signalKind],
        reasons: [signalKind],
        score,
      },
      decision: {
        status: opts.status ?? "scanning",
        score,
        finding: {
          entities: [{
            type: opts.entityKind ?? "company",
            displayName: entityName,
            entityKey,
            confidence: score,
          }],
          signals: [signalKind],
          reasons: [signalKind],
          score,
        },
      },
      createdAt: now - ageMs,
      updatedAt: now - ageMs,
      attempts: 0,
    }),
  );
  return row;
}

/** Helper: run scanActivityRow on a specific row by fetching it from the DB. */
async function scanRow(
  t: ReturnType<typeof convexTest>,
  rowId: Id<"roomActivityOutbox">,
) {
  return t.run(async (ctx) => {
    const row = await ctx.db.get(rowId);
    if (!row) throw new Error("Row not found");
    return scanActivityRow(ctx, row, Date.now());
  });
}

describe("P3.2: Policy hierarchy — most restrictive wins", () => {
  it("system default is suggestions_only when no room policy exists", async () => {
    const { t, roomId } = await setupRoom();
    const policy = await t.query(api.roomActivity.roomAssistivePolicy, { roomId });
    expect(policy?.mode).toBe("suggestions_only");
    expect(policy?.source).toBe("system_default");
  });

  it("setRoomAssistivePolicy creates a room policy and it is returned by roomAssistivePolicy", async () => {
    const { t, proof, roomId } = await setupRoom();
    await t.mutation(api.roomActivity.setRoomAssistivePolicy, {
      roomId,
      requester: proof,
      mode: "ask_before_research",
    });
    const policy = await t.query(api.roomActivity.roomAssistivePolicy, { roomId });
    expect(policy?.mode).toBe("ask_before_research");
    expect(policy?.source).toBe("room_policy");
  });

  it("setRoomAssistivePolicy updates an existing room policy", async () => {
    const { t, proof, roomId } = await setupRoom();
    await t.mutation(api.roomActivity.setRoomAssistivePolicy, {
      roomId,
      requester: proof,
      mode: "suggestions_only",
    });
    await t.mutation(api.roomActivity.setRoomAssistivePolicy, {
      roomId,
      requester: proof,
      mode: "off",
    });
    const policy = await t.query(api.roomActivity.roomAssistivePolicy, { roomId });
    expect(policy?.mode).toBe("off");
  });

  it("scanActivityRow suppresses with reason policy_off when mode is off", async () => {
    const { t, proof, roomId } = await setupRoom();
    await t.mutation(api.roomActivity.setRoomAssistivePolicy, {
      roomId,
      requester: proof,
      mode: "off",
    });
    const nodeId = await seedNode(t, roomId, "CardioNova Therapeutics announced Series A funding raise of $50M.");
    const rowId = await seedOutboxRow(t, roomId, { sourceId: String(nodeId) });
    const result = await scanRow(t, rowId);
    expect(result.status).toBe("not_noteworthy");
    expect((result as any).reason).toBe("policy_off");
  });

  it("scanActivityRow suppresses with reason not_on_watchlist when mode is approved_watchlist_only and entity not watchlisted", async () => {
    const { t, proof, roomId } = await setupRoom();
    await t.mutation(api.roomActivity.setRoomAssistivePolicy, {
      roomId,
      requester: proof,
      mode: "approved_watchlist_only",
      approvedEntityWatchlist: ["AllowedCo"],
    });
    const nodeId = await seedNode(t, roomId, "NotWatchlisted Inc announced Series A funding, hired a new CEO, launched a customer pilot, and shared revenue growth.");
    const rowId = await seedOutboxRow(t, roomId, { entityName: "NotWatchlisted", sourceId: String(nodeId) });
    const result = await scanRow(t, rowId);
    expect(result.status).toBe("not_noteworthy");
    expect((result as any).reason).toBe("not_on_watchlist");
  });

  it("scanActivityRow allows suggestion when entity IS on watchlist", async () => {
    const { t, proof, roomId } = await setupRoom();
    await t.mutation(api.roomActivity.setRoomAssistivePolicy, {
      roomId,
      requester: proof,
      mode: "approved_watchlist_only",
      approvedEntityWatchlist: ["AllowedCo"],
    });
    const nodeId = await seedNode(t, roomId, "AllowedCo announced Series B funding, hired a new CEO, launched a customer pilot, and shared revenue growth.");
    const rowId = await seedOutboxRow(t, roomId, { entityName: "AllowedCo", sourceId: String(nodeId) });
    const result = await scanRow(t, rowId);
    // Should NOT be suppressed with not_on_watchlist — it should either be noteworthy or hit another check.
    expect((result as any).reason).not.toBe("not_on_watchlist");
  });
});

describe("P3.3: Signal-based dismissal feedback", () => {
  it("dismissActivity with dismissReason and scope records suggestionFeedback", async () => {
    const { t, proof, roomId } = await setupRoom();
    const rowId = await seedOutboxRow(t, roomId, {
      status: "noteworthy",
      entityName: "DismissMe",
      signalKind: "entity_mention",
    });
    await t.mutation(api.roomActivity.dismissActivity, {
      activityId: rowId,
      roomId,
      requester: proof,
      dismissReason: "too_noisy",
      scope: "signal",
    });

    // Verify suggestionFeedback row was created.
    const feedback = await t.run((ctx) =>
      ctx.db.query("suggestionFeedback")
        .withIndex("by_suggestion", (q) => q.eq("suggestionId", rowId))
        .first(),
    );
    expect(feedback).toBeTruthy();
    expect(feedback?.dismissReason).toBe("too_noisy");
    expect(feedback?.scope).toBe("signal");
    expect(feedback?.signalFingerprintHash).toContain("entity_mention");
  });

  it("dismissActivity without dismissReason does not create suggestionFeedback", async () => {
    const { t, proof, roomId } = await setupRoom();
    const rowId = await seedOutboxRow(t, roomId, {
      status: "noteworthy",
      entityName: "SimpleDismiss",
    });
    await t.mutation(api.roomActivity.dismissActivity, {
      activityId: rowId,
      roomId,
      requester: proof,
    });

    const feedback = await t.run((ctx) =>
      ctx.db.query("suggestionFeedback")
        .withIndex("by_suggestion", (q) => q.eq("suggestionId", rowId))
        .first(),
    );
    expect(feedback).toBeNull();
  });

  it("scanActivityRow suppresses signal_dismissed when matching signal fingerprint was previously dismissed", async () => {
    const { t, proof, roomId } = await setupRoom();
    // First: seed a node, scan it to get real classified finding, then dismiss with signal scope.
    const node1Id = await seedNode(t, roomId, "NoisyCo Inc announced a product launch and customer pilot.");
    const row1Id = await seedOutboxRow(t, roomId, {
      entityName: "NoisyCo",
      signalKind: "entity_mention",
      sourceKind: "node",
      sourceId: String(node1Id),
    });
    // Scan row1 to get the real classified finding with actual signals.
    await scanRow(t, row1Id);
    // Now dismiss with signal scope.
    await t.mutation(api.roomActivity.dismissActivity, {
      activityId: row1Id,
      roomId,
      requester: proof,
      dismissReason: "too_noisy",
      scope: "signal",
    });

    // Second: a new suggestion with the same signal fingerprint should be suppressed.
    const node2Id = await seedNode(t, roomId, "DifferentCo Ltd announced Series B funding and revenue growth.");
    const row2Id = await seedOutboxRow(t, roomId, {
      entityName: "DifferentCo",
      signalKind: "entity_mention",
      sourceKind: "node",
      sourceId: String(node2Id),
    });
    const result = await scanRow(t, row2Id);
    expect(result.status).toBe("not_noteworthy");
    expect((result as any).reason).toBe("signal_dismissed");
  });

  it("signal-scoped suppression does not affect different signal kinds", async () => {
    const { t, proof, roomId } = await setupRoom();
    const node1Id = await seedNode(t, roomId, "NoisyCo Inc announced a product launch and customer pilot.");
    const row1Id = await seedOutboxRow(t, roomId, {
      entityName: "NoisyCo",
      signalKind: "entity_mention",
      sourceKind: "node",
      sourceId: String(node1Id),
    });
    // Scan row1 to get real classified finding, then dismiss with signal scope.
    await scanRow(t, row1Id);
    await t.mutation(api.roomActivity.dismissActivity, {
      activityId: row1Id,
      roomId,
      requester: proof,
      dismissReason: "too_noisy",
      scope: "signal",
    });

    // Different signal fingerprint — use a message source so the fingerprint hash differs.
    const msgId = await t.run((ctx) =>
      ctx.db.insert("messages", {
        roomId,
        channel: "public",
        author: { kind: "user" as const, id: "host", name: "Host" },
        text: "DifferentCo Ltd revenue grew 200% with strong margins.",
        clientMsgId: `msg_${Math.random()}`,
        kind: "chat" as const,
        createdAt: Date.now(),
      }),
    );
    const row2Id = await seedOutboxRow(t, roomId, {
      entityName: "DifferentCo",
      signalKind: "metric_anomaly",
      sourceKind: "message",
      sourceId: String(msgId),
    });
    const result = await scanRow(t, row2Id);
    expect((result as any).reason).not.toBe("signal_dismissed");
  });
});

describe("P3.4: Cost preview with bands", () => {
  it("returns conservative static estimates with low confidence when no history exists", async () => {
    const { t, roomId } = await setupRoom();
    const result = await t.query(api.roomActivity.researchCostPreview, { roomId });
    expect(result?.confidence).toBe("low");
    expect(result?.p50Usd).toBeGreaterThan(0);
    expect(result?.p90Usd).toBeGreaterThan(result?.p50Usd ?? 0);
    expect(result?.hardCapUsd).toBeGreaterThan(result?.p90Usd ?? 0);
    expect(result?.sampleSize).toBe(0);
    expect(result?.basis).toBe("cold_start_no_history");
  });
});

describe("P3.5: Server-side digest job", () => {
  it("buildDigests returns 0 digests when fewer than 5 noteworthy items exist", async () => {
    const { t, roomId } = await setupRoom();
    // Seed only 2 noteworthy items.
    await seedOutboxRow(t, roomId, { status: "noteworthy", entityName: "CoA" });
    await seedOutboxRow(t, roomId, { status: "noteworthy", entityName: "CoB" });
    const result = await t.mutation(internal.roomActivity.buildDigests, { roomId });
    expect(result.digestsCreated).toBe(0);
    expect(result.archived).toBe(0);
  });

  it("buildDigests creates digest rows when 5+ noteworthy items with 2+ per entity exist", async () => {
    const { t, roomId } = await setupRoom();
    // Seed 6 items: 3 for CoA, 2 for CoB, 1 for CoC.
    await seedOutboxRow(t, roomId, { status: "noteworthy", entityName: "CoA" });
    await seedOutboxRow(t, roomId, { status: "noteworthy", entityName: "CoA" });
    await seedOutboxRow(t, roomId, { status: "noteworthy", entityName: "CoA" });
    await seedOutboxRow(t, roomId, { status: "noteworthy", entityName: "CoB" });
    await seedOutboxRow(t, roomId, { status: "noteworthy", entityName: "CoB" });
    await seedOutboxRow(t, roomId, { status: "noteworthy", entityName: "CoC" });

    const result = await t.mutation(internal.roomActivity.buildDigests, { roomId });
    // CoA (3 items) and CoB (2 items) should get digests; CoC (1 item) should not.
    expect(result.digestsCreated).toBe(2);

    // Verify digests are queryable.
    const digests = await t.query(api.roomActivity.suggestionDigests, { roomId });
    expect(digests.length).toBe(2);
    const titles = digests.map((d) => d.title);
    expect(titles).toContain("CoA");
    expect(titles).toContain("CoB");
  });

  it("buildDigests archives suggestions older than 7 days", async () => {
    const { t, roomId } = await setupRoom();
    // Seed 5 items for the same entity, all 8 days old.
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 5; i++) {
      await seedOutboxRow(t, roomId, {
        status: "noteworthy",
        entityName: "OldCo",
        ageMs: eightDays,
      });
    }
    const result = await t.mutation(internal.roomActivity.buildDigests, { roomId });
    expect(result.archived).toBe(5);
  });
});

describe("P3.2 + P3.3: Policy and dismissal interaction", () => {
  it("policy_off takes precedence over signal dismissal — policy is checked first", async () => {
    const { t, proof, roomId } = await setupRoom();
    // Set up signal dismissal.
    const node1Id = await seedNode(t, roomId, "NoisyCo Inc announced a product launch and customer pilot.");
    const row1Id = await seedOutboxRow(t, roomId, {
      entityName: "NoisyCo",
      signalKind: "entity_mention",
      sourceKind: "node",
      sourceId: String(node1Id),
    });
    // Scan row1 to get real classified finding, then dismiss with signal scope.
    await scanRow(t, row1Id);
    await t.mutation(api.roomActivity.dismissActivity, {
      activityId: row1Id,
      roomId,
      requester: proof,
      dismissReason: "too_noisy",
      scope: "signal",
    });

    // Now set policy to off.
    await t.mutation(api.roomActivity.setRoomAssistivePolicy, {
      roomId,
      requester: proof,
      mode: "off",
    });

    const node2Id = await seedNode(t, roomId, "AnyCo Ltd announced Series A funding and revenue growth.");
    const row2Id = await seedOutboxRow(t, roomId, {
      entityName: "AnyCo",
      signalKind: "entity_mention",
      sourceKind: "node",
      sourceId: String(node2Id),
    });
    const result = await scanRow(t, row2Id);
    // policy_off should win over signal_dismissed since it's checked first.
    expect(result.status).toBe("not_noteworthy");
    expect((result as any).reason).toBe("policy_off");
  });
});
