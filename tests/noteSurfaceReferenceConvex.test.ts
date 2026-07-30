// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { hashToken } from "../convex/lib";
import { referenceDigest } from "../src/engine/noteSurfaceReference";
import {
  buildNoteSurfaceReferenceFixture,
  NOTE_REFERENCE_TRUST_POLICY_JSON,
  resealNoteSurfaceReferenceFixture,
} from "./fixtures/noteSurfaceReferenceFixture";

const modules = import.meta.glob("../convex/**/*.ts");
for (const modulePath of [
  "../convex/agent.ts",
  "../convex/agentJobRunner.ts",
  "../convex/agentWorkflows.ts",
  "../convex/embeddingRunner.ts",
]) {
  delete (modules as Record<string, unknown>)[modulePath];
}

const HOST_TOKEN = "note-surface-reference-host-token-0123456789";
const GUEST_TOKEN = "note-surface-reference-guest-token-0123456789";
process.env.NODEKIT_REFERENCE_TRUST_POLICY_JSON = NOTE_REFERENCE_TRUST_POLICY_JSON;
const createHarness = () => convexTest(schema, modules);
type Harness = ReturnType<typeof createHarness>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-30T05:01:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

async function seedNote(t: Harness, kind: "note" | "sheet" = "note") {
  const seeded = await t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code: `NR${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Reference consumption review",
      hostId: "pending",
      autoAllow: false,
      status: "live" as const,
      createdAt: now,
    });
    const hostId = await ctx.db.insert("members", {
      roomId,
      name: "Maya",
      role: "host" as const,
      anon: false,
      color: "#2E9E6B",
      authTokenHash: await hashToken(HOST_TOKEN),
      lastSeenAt: now,
    });
    const guestId = await ctx.db.insert("members", {
      roomId,
      name: "Ravi",
      role: "member" as const,
      anon: false,
      color: "#C56A45",
      authTokenHash: await hashToken(GUEST_TOKEN),
      lastSeenAt: now,
    });
    await ctx.db.patch(roomId, { hostId: String(hostId) });
    return {
      roomId,
      host: {
        actor: { kind: "user" as const, id: String(hostId), name: "Maya" },
        token: HOST_TOKEN,
      },
      guest: {
        actor: { kind: "user" as const, id: String(guestId), name: "Ravi" },
        token: GUEST_TOKEN,
      },
    };
  });
  const artifactId = await t.mutation(api.artifacts.createArtifact, {
    roomId: seeded.roomId,
    kind,
    title: kind === "note" ? "Capture Notebook" : "Reference Sheet",
    seed: [{ id: "doc", value: "<p>Initial evidence note</p>" }],
    proof: seeded.host,
  });
  return { ...seeded, artifactId };
}

async function artifactState(t: Harness, artifactId: Id<"artifacts">) {
  return t.run(async (ctx) => ctx.db.get(artifactId));
}

async function resealExternalRun(
  consumption: Awaited<ReturnType<typeof buildNoteSurfaceReferenceFixture>>,
) {
  const next = structuredClone(consumption);
  const { contentDigest: _externalDigest, ...externalBody } = next.snapshots.externalRun;
  next.snapshots.externalRun.contentDigest = await referenceDigest(externalBody);
  return resealNoteSurfaceReferenceFixture(next);
}

describe("artifacts.setNoteSurfaceReferenceConsumption", () => {
  it("rejects a digest-closed record whose Mobbin service signature is not trusted", async () => {
    const t = createHarness();
    const seeded = await seedNote(t);
    const consumption = await buildNoteSurfaceReferenceFixture(
      String(seeded.roomId),
      String(seeded.artifactId),
      String(seeded.host.actor.id),
    );

    const configuredPolicy = process.env.NODEKIT_REFERENCE_TRUST_POLICY_JSON;
    delete process.env.NODEKIT_REFERENCE_TRUST_POLICY_JSON;
    const result = await t.mutation(
      internal.artifacts.setNoteSurfaceReferenceConsumption,
      {
        roomId: seeded.roomId,
        artifactId: seeded.artifactId,
        expectedArtifactVersion: 1,
        consumption,
        requester: seeded.host,
      },
    ).finally(() => {
      process.env.NODEKIT_REFERENCE_TRUST_POLICY_JSON = configuredPolicy;
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_reference_authority",
      findings: expect.arrayContaining(["external-run-trust-policy-unconfigured"]),
    });
    expect((await artifactState(t, seeded.artifactId))?.version).toBe(1);
  });

  it("bounds the deployed trust policy before parsing an agent-supplied receipt", async () => {
    const t = createHarness();
    const seeded = await seedNote(t);
    const consumption = await buildNoteSurfaceReferenceFixture(
      String(seeded.roomId),
      String(seeded.artifactId),
      String(seeded.host.actor.id),
    );
    const configuredPolicy = process.env.NODEKIT_REFERENCE_TRUST_POLICY_JSON;
    process.env.NODEKIT_REFERENCE_TRUST_POLICY_JSON = " ".repeat(64 * 1024 + 1);
    const result = await t.mutation(
      internal.artifacts.setNoteSurfaceReferenceConsumption,
      {
        roomId: seeded.roomId,
        artifactId: seeded.artifactId,
        expectedArtifactVersion: 1,
        consumption,
        requester: seeded.host,
      },
    ).finally(() => {
      process.env.NODEKIT_REFERENCE_TRUST_POLICY_JSON = configuredPolicy;
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_reference_authority",
      findings: ["external-run-trust-policy-invalid"],
    });
    expect((await artifactState(t, seeded.artifactId))?.version).toBe(1);
  });

  it("rejects an operator payload whose digest was resealed after its service signature was forged", async () => {
    const t = createHarness();
    const seeded = await seedNote(t);
    const consumption = await buildNoteSurfaceReferenceFixture(
      String(seeded.roomId),
      String(seeded.artifactId),
      String(seeded.host.actor.id),
    );
    consumption.snapshots.externalRun.attestation.signature =
      `${consumption.snapshots.externalRun.attestation.signature.slice(0, -1)}B`;
    const forged = await resealExternalRun(consumption);

    const result = await t.mutation(internal.artifacts.setNoteSurfaceReferenceConsumption, {
      roomId: seeded.roomId,
      artifactId: seeded.artifactId,
      expectedArtifactVersion: 1,
      consumption: forged,
      requester: seeded.host,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_reference_authority",
      findings: expect.arrayContaining(["external-run-service-signature-invalid"]),
    });
    expect((await artifactState(t, seeded.artifactId))?.version).toBe(1);
  });

  it("fails closed when the deployed trust-policy bytes drift from the score receipt", async () => {
    const t = createHarness();
    const seeded = await seedNote(t);
    const consumption = await buildNoteSurfaceReferenceFixture(
      String(seeded.roomId),
      String(seeded.artifactId),
      String(seeded.host.actor.id),
    );
    const configuredPolicy = process.env.NODEKIT_REFERENCE_TRUST_POLICY_JSON;
    process.env.NODEKIT_REFERENCE_TRUST_POLICY_JSON = `${NOTE_REFERENCE_TRUST_POLICY_JSON}\n`;
    const result = await t.mutation(
      internal.artifacts.setNoteSurfaceReferenceConsumption,
      {
        roomId: seeded.roomId,
        artifactId: seeded.artifactId,
        expectedArtifactVersion: 1,
        consumption,
        requester: seeded.host,
      },
    ).finally(() => {
      process.env.NODEKIT_REFERENCE_TRUST_POLICY_JSON = configuredPolicy;
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_reference_authority",
      findings: expect.arrayContaining(["external-run-trust-policy-drift"]),
    });
    expect((await artifactState(t, seeded.artifactId))?.version).toBe(1);
  });

  it("rejects a previously valid external run after its bounded seven-day authority window", async () => {
    const t = createHarness();
    const seeded = await seedNote(t);
    const consumption = await buildNoteSurfaceReferenceFixture(
      String(seeded.roomId),
      String(seeded.artifactId),
      String(seeded.host.actor.id),
    );
    vi.setSystemTime(new Date("2026-08-06T05:00:00.001Z"));

    const result = await t.mutation(internal.artifacts.setNoteSurfaceReferenceConsumption, {
      roomId: seeded.roomId,
      artifactId: seeded.artifactId,
      expectedArtifactVersion: 1,
      consumption,
      requester: seeded.host,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_reference_authority",
      findings: expect.arrayContaining(["external-run-attestation-stale"]),
    });
    expect((await artifactState(t, seeded.artifactId))?.version).toBe(1);
  });

  it("persists one authority-validated record, treats exact replay as idempotent, and increments once", async () => {
    const t = createHarness();
    const seeded = await seedNote(t);
    const consumption = await buildNoteSurfaceReferenceFixture(
      String(seeded.roomId),
      String(seeded.artifactId),
      String(seeded.host.actor.id),
    );

    const first = await t.mutation(internal.artifacts.setNoteSurfaceReferenceConsumption, {
      roomId: seeded.roomId,
      artifactId: seeded.artifactId,
      expectedArtifactVersion: 1,
      consumption,
      requester: seeded.host,
    });
    const replay = await t.mutation(internal.artifacts.setNoteSurfaceReferenceConsumption, {
      roomId: seeded.roomId,
      artifactId: seeded.artifactId,
      expectedArtifactVersion: 1,
      consumption,
      requester: seeded.host,
    });
    const state = await artifactState(t, seeded.artifactId);

    expect(first).toEqual({ ok: true, version: 2, idempotent: false });
    expect(replay).toEqual({ ok: true, version: 2, idempotent: true });
    expect(state?.version).toBe(2);
    expect((state?.meta as { noteSurfaceReferenceConsumption?: { consumptionId?: string } })
      .noteSurfaceReferenceConsumption?.consumptionId).toBe(consumption.consumptionId);
  });

  it("allows exactly one concurrent promotion and returns one stale conflict without lost state", async () => {
    const t = createHarness();
    const seeded = await seedNote(t);
    const first = await buildNoteSurfaceReferenceFixture(
      String(seeded.roomId),
      String(seeded.artifactId),
      String(seeded.host.actor.id),
    );
    const secondDraft = structuredClone(first);
    secondDraft.reviewBinding.reviewReceiptId = "review:note-surface:independent-model";
    secondDraft.reviewBinding.reviewReceiptDigest = "d".repeat(64);
    const second = await resealNoteSurfaceReferenceFixture(secondDraft);

    const results = await Promise.all([
      t.mutation(internal.artifacts.setNoteSurfaceReferenceConsumption, {
        roomId: seeded.roomId,
        artifactId: seeded.artifactId,
        expectedArtifactVersion: 1,
        consumption: first,
        requester: seeded.host,
      }),
      t.mutation(internal.artifacts.setNoteSurfaceReferenceConsumption, {
        roomId: seeded.roomId,
        artifactId: seeded.artifactId,
        expectedArtifactVersion: 1,
        consumption: second,
        requester: seeded.host,
      }),
    ]);
    const state = await artifactState(t, seeded.artifactId);
    const storedId = (state?.meta as {
      noteSurfaceReferenceConsumption?: { consumptionId?: string };
    }).noteSurfaceReferenceConsumption?.consumptionId;

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === "conflict")).toHaveLength(1);
    expect(state?.version).toBe(2);
    expect([first.consumptionId, second.consumptionId]).toContain(storedId);
  });

  it("rejects a top-level-resealed nested forgery without mutating the artifact", async () => {
    const t = createHarness();
    const seeded = await seedNote(t);
    const forged = await buildNoteSurfaceReferenceFixture(
      String(seeded.roomId),
      String(seeded.artifactId),
      String(seeded.host.actor.id),
    );
    forged.snapshots.observations[0]!.facts[0]!.object = "caller-forged relationship";
    const topLevelResealed = await resealNoteSurfaceReferenceFixture(forged);

    const result = await t.mutation(internal.artifacts.setNoteSurfaceReferenceConsumption, {
      roomId: seeded.roomId,
      artifactId: seeded.artifactId,
      expectedArtifactVersion: 1,
      consumption: topLevelResealed,
      requester: seeded.host,
    });
    const state = await artifactState(t, seeded.artifactId);

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_reference_consumption",
      findings: expect.arrayContaining(["observation-content-digest"]),
    });
    expect(state?.version).toBe(1);
    expect((state?.meta as { noteSurfaceReferenceConsumption?: unknown } | undefined)
      ?.noteSurfaceReferenceConsumption).toBeUndefined();
  });

  it("rejects a non-owner and refuses non-note artifacts", async () => {
    const t = createHarness();
    const note = await seedNote(t);
    const consumption = await buildNoteSurfaceReferenceFixture(
      String(note.roomId),
      String(note.artifactId),
      String(note.host.actor.id),
    );
    await expect(t.mutation(internal.artifacts.setNoteSurfaceReferenceConsumption, {
      roomId: note.roomId,
      artifactId: note.artifactId,
      expectedArtifactVersion: 1,
      consumption,
      requester: note.guest,
    })).rejects.toThrow(/artifact_meta_forbidden/);

    const sheet = await seedNote(t, "sheet");
    const sheetConsumption = await buildNoteSurfaceReferenceFixture(
      String(sheet.roomId),
      String(sheet.artifactId),
      String(sheet.host.actor.id),
    );
    expect(await t.mutation(internal.artifacts.setNoteSurfaceReferenceConsumption, {
      roomId: sheet.roomId,
      artifactId: sheet.artifactId,
      expectedArtifactVersion: 1,
      consumption: sheetConsumption,
      requester: sheet.host,
    })).toEqual({ ok: false, reason: "not_note" });
  });
});
