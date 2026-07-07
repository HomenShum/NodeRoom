// @vitest-environment edge-runtime
/**
 * Audit evidence bundle export — server scenarios against a REAL in-memory
 * Convex deployment (convex-test, prosemirror-sync component registered like
 * the notebook harness).
 *
 * Persona: Maya hosts the starter diligence room and must hand an auditor a
 * signed bundle of the "Company research" sheet — CSV + evidence sources +
 * trace excerpt + hashed manifest — as downloadable room files. Covered angles:
 *   (a) happy path: four file artifacts land, CSV is non-empty with dataframe
 *       headers + seeded companies, evidence entries carry elementId/url,
 *       author is the requesting USER actor (Maya, kind "user")
 *   (b) determinism (sustained re-export): three consecutive exports on
 *       identical sheet data produce the SAME manifestHash — and the stored
 *       manifest text re-hashes to exactly that hash (signature check)
 *   (c) adversarial: a bad proof token is rejected and creates nothing
 *   (d) visibility honesty: another member's PRIVATE sheet cells and PRIVATE
 *       agent traces never leak into Maya's bundle; Maya's own private-agent
 *       traces stay; exporting the other member's private sheet directly
 *       refuses; the owner can export their own private sheet
 *   (e) bounds: a 25,001-element sheet refuses with sheet_too_large (no partial
 *       bundle), and a note artifact refuses with not_a_sheet
 */
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import prosemirrorSchema from "../node_modules/@convex-dev/prosemirror-sync/src/component/schema";

vi.setConfig({ testTimeout: 60_000 });

const modules = import.meta.glob("../convex/**/*.ts");
const prosemirrorModules = import.meta.glob("../node_modules/@convex-dev/prosemirror-sync/src/component/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const ROOM_CODE = "AUDITB1";
const HOST_TOKEN = "audit-bundle-host-token-0123456789";
const RILEY_TOKEN = "audit-bundle-riley-token-9876543210";

// convex/_generated lags until the next codegen — which must NOT be run
// casually here: `npx convex codegen` against a configured cloud deployment
// DEPLOYS schema+functions (documented gotcha). Same reference pattern as
// tests/elementVersions.test.ts; convex-test resolves by name at runtime.
type ActorProof = { actor: { kind: "user" | "agent"; id: string; name: string; scope?: "public" | "private"; ownerId?: string }; token?: string };
type BundleResult =
  | { ok: true; artifactIds: string[]; manifestHash: string }
  | { ok: false; reason: string };
const buildEvidenceBundleRef = makeFunctionReference<
  "action",
  { roomId: Id<"rooms">; artifactId: Id<"artifacts">; requester: ActorProof },
  BundleResult
>("auditBundle:buildEvidenceBundle");

async function seedRoom() {
  const t = convexTest(schema, modules);
  t.registerComponent("prosemirrorSync", prosemirrorSchema, prosemirrorModules);
  const created = await t.mutation(api.rooms.createStarterRoom, {
    code: ROOM_CODE,
    title: "Audit bundle proof room",
    hostName: "Maya",
    authToken: HOST_TOKEN,
  });
  const actor = { kind: "user" as const, id: String(created.memberId), name: "Maya" };
  const proof = { actor, token: HOST_TOKEN };
  const meta = await t.query(api.rooms.meta, { roomId: created.roomId, requester: proof });
  if (!meta) throw new Error("starter room meta not found");
  const sheet = meta.artifacts.find((a) => a.kind === "sheet" && a.title === "Company research");
  if (!sheet) throw new Error("starter research sheet not found");
  const note = meta.artifacts.find((a) => a.kind === "note");
  if (!note) throw new Error("starter note not found");
  return {
    t,
    roomId: created.roomId,
    memberId: created.memberId,
    sheetId: sheet.id as Id<"artifacts">,
    noteId: note.id as Id<"artifacts">,
    actor,
    proof,
  };
}

type Harness = Awaited<ReturnType<typeof seedRoom>>;

/** Give one seeded cell a real CellPayload with evidence — the "sources" the bundle attests to. */
async function addEvidenceToFundingCell(h: Harness) {
  await h.t.run(async (ctx) => {
    const el = await ctx.db
      .query("elements")
      .withIndex("by_artifact", (q) => q.eq("artifactId", h.sheetId).eq("elementId", "rc_cardionova__funding"))
      .unique();
    if (!el) throw new Error("seed funding cell missing");
    await ctx.db.patch(el._id, {
      value: {
        value: "Raised $32M Series B",
        status: "complete",
        evidence: [
          {
            id: "ev_tc_1",
            kind: "source",
            label: "TechCrunch",
            url: "https://techcrunch.com/cardionova-series-b",
            snippet: "CardioNova announced a $32M Series B led by...",
          },
        ],
      },
    });
  });
}

/** The bundle parts as stored: [csv, evidence, trace, manifest] doc texts + authorship. */
async function readBundleParts(h: Harness, artifactIds: string[]) {
  return h.t.run(async (ctx) => {
    const parts: Array<{ title: string; text: string; createdBy: { kind: string; id: string; name: string } | undefined }> = [];
    for (const id of artifactIds) {
      const art = await ctx.db.get(id as Id<"artifacts">);
      if (!art) throw new Error(`bundle artifact ${id} missing`);
      const doc = await ctx.db
        .query("elements")
        .withIndex("by_artifact", (q) => q.eq("artifactId", art._id).eq("elementId", "doc"))
        .unique();
      const text = (doc?.value as { text?: string } | undefined)?.text ?? "";
      parts.push({ title: art.title, text, createdBy: art.createdBy as { kind: string; id: string; name: string } | undefined });
    }
    return parts;
  });
}

async function countBundleArtifacts(h: Harness): Promise<number> {
  return h.t.run(async (ctx) => {
    const arts = await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", h.roomId)).collect();
    return arts.filter((a) => a.title.startsWith("evidence-bundle")).length;
  });
}

async function sha256HexTest(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("auditBundle.buildEvidenceBundle — signed evidence bundle export", () => {
  it("host exports after the demo seed: 4 user-authored parts, non-empty CSV, evidence sources, and a manifest hash that is stable across three runs", async () => {
    const h = await seedRoom();
    await addEvidenceToFundingCell(h);

    const run1 = await h.t.action(buildEvidenceBundleRef, { roomId: h.roomId, artifactId: h.sheetId, requester: h.proof });
    expect(run1.ok).toBe(true);
    if (!run1.ok) throw new Error("export failed");
    expect(run1.artifactIds).toHaveLength(4);
    expect(run1.manifestHash).toMatch(/^[0-9a-f]{64}$/);

    const [csvPart, evidencePart, tracePart, manifestPart] = await readBundleParts(h, run1.artifactIds);

    // (a) CSV: non-empty, dataframe-column headers, seeded row data, RFC4180 CRLF lines.
    expect(csvPart.title).toMatch(/^evidence-bundle-.*\.csv$/);
    expect(csvPart.text.length).toBeGreaterThan(100);
    const headerLine = csvPart.text.split("\r\n")[0];
    expect(headerLine).toContain("row_id");
    expect(headerLine).toContain("company");
    expect(headerLine).toContain("recent signal"); // label from meta.dataframe.columns, not the raw id
    expect(csvPart.text).toContain("CardioNova");
    expect(csvPart.text).toContain("Mercury");
    // Flattened CellPayload: the CSV shows the inner value, not the JSON wrapper.
    expect(csvPart.text).toContain("Raised $32M Series B");
    expect(csvPart.text).not.toContain('"status":"complete"');

    // (a) evidence list: elementId + label + url + snippet survive.
    const evidence = JSON.parse(evidencePart.text) as Array<{ elementId: string; label: string; url: string | null; snippet: string | null }>;
    expect(evidence.length).toBeGreaterThan(0);
    const tc = evidence.find((e) => e.elementId === "rc_cardionova__funding");
    expect(tc?.label).toBe("TechCrunch");
    expect(tc?.url).toBe("https://techcrunch.com/cardionova-series-b");
    expect(tc?.snippet).toContain("Series B");

    // (a) trace excerpt: real room history is attested (room_created is in the seed).
    const traces = JSON.parse(tracePart.text) as Array<{ type: string; summary: string }>;
    expect(traces.length).toBeGreaterThan(0);
    expect(traces.some((tr) => tr.type === "room_created")).toBe(true);

    // (a) authorship: every part is authored by the requesting USER actor.
    for (const part of [csvPart, evidencePart, tracePart, manifestPart]) {
      expect(part.createdBy?.kind).toBe("user");
      expect(part.createdBy?.name).toBe("Maya");
      expect(part.createdBy?.id).toBe(String(h.memberId));
    }

    // (b) signature: the stored manifest text re-hashes to the returned manifestHash,
    // and the manifest's per-part hashes match the stored part contents.
    expect(await sha256HexTest(manifestPart.text)).toBe(run1.manifestHash);
    const manifest = JSON.parse(manifestPart.text) as {
      bundle: string;
      parts: Array<{ name: string; sha256: string; bytes: number }>;
      requestedBy: { kind: string; name: string };
    };
    expect(manifest.bundle).toBe("evidence_bundle_v1");
    expect(manifest.parts).toHaveLength(3);
    expect(manifest.requestedBy).toMatchObject({ kind: "user", name: "Maya" });
    expect(manifest.parts[0].sha256).toBe(await sha256HexTest(csvPart.text));
    expect(manifest.parts[1].sha256).toBe(await sha256HexTest(evidencePart.text));
    expect(manifest.parts[2].sha256).toBe(await sha256HexTest(tracePart.text));

    // (b) determinism, sustained: re-export twice more on identical sheet data.
    // The exporter's own file-generation traces are excluded from the excerpt,
    // so the manifest hash is a fixed point — byte-identical attestation.
    const run2 = await h.t.action(buildEvidenceBundleRef, { roomId: h.roomId, artifactId: h.sheetId, requester: h.proof });
    const run3 = await h.t.action(buildEvidenceBundleRef, { roomId: h.roomId, artifactId: h.sheetId, requester: h.proof });
    if (!run2.ok || !run3.ok) throw new Error("re-export failed");
    expect(run2.manifestHash).toBe(run1.manifestHash);
    expect(run3.manifestHash).toBe(run1.manifestHash);
    // Each run persists 4 NEW artifacts — no clobbering of earlier receipts.
    expect(new Set([...run1.artifactIds, ...run2.artifactIds, ...run3.artifactIds]).size).toBe(12);
    expect(await countBundleArtifacts(h)).toBe(12);

    // Determinism is honest, not accidental: actually CHANGE the data → hash moves.
    await h.t.run(async (ctx) => {
      const el = await ctx.db
        .query("elements")
        .withIndex("by_artifact", (q) => q.eq("artifactId", h.sheetId).eq("elementId", "rc_cardionova__headcount"))
        .unique();
      if (!el) throw new Error("headcount cell missing");
      await ctx.db.patch(el._id, { value: "120 (verified)" });
    });
    const run4 = await h.t.action(buildEvidenceBundleRef, { roomId: h.roomId, artifactId: h.sheetId, requester: h.proof });
    if (!run4.ok) throw new Error("post-edit export failed");
    expect(run4.manifestHash).not.toBe(run1.manifestHash);
  });

  it("rejects a bad proof token and creates nothing", async () => {
    const h = await seedRoom();
    const before = await countBundleArtifacts(h);
    await expect(
      h.t.action(buildEvidenceBundleRef, {
        roomId: h.roomId,
        artifactId: h.sheetId,
        requester: { actor: h.actor, token: "wrong-token-wrong-token-wrong-token" },
      }),
    ).rejects.toThrow(/invalid_actor_token/);
    expect(await countBundleArtifacts(h)).toBe(before);
  });

  it("visibility honesty: another member's private cells and private-agent traces never leak; own private traces stay; direct private export refuses for non-owners", async () => {
    const h = await seedRoom();
    const joined = await h.t.mutation(api.rooms.joinAnonymous, { code: ROOM_CODE, name: "Riley", authToken: RILEY_TOKEN, anon: false });
    if (!joined || "error" in joined) throw new Error("riley join failed");
    const rileyActor = { kind: "user" as const, id: String(joined.memberId), name: "Riley" };

    const rileySheetId = await h.t.run(async (ctx) => {
      const now = Date.now();
      const artifactId = await ctx.db.insert("artifacts", {
        roomId: h.roomId,
        kind: "sheet",
        title: "Riley private model",
        version: 1,
        order: ["rp1__label", "rp1__note"],
        updatedAt: now,
        createdBy: rileyActor,
        visibility: "private",
      });
      await ctx.db.insert("elements", { artifactId, elementId: "rp1__label", value: "RILEY-SECRET-CELL-99", version: 1, updatedAt: now, updatedBy: rileyActor });
      await ctx.db.insert("elements", { artifactId, elementId: "rp1__note", value: "RILEY-SECRET-NOTE", version: 1, updatedAt: now, updatedBy: rileyActor });
      // Riley's PRIVATE agent worked for Riley — that trace must not appear in Maya's bundle.
      await ctx.db.insert("traces", {
        roomId: h.roomId,
        ts: now,
        actor: { kind: "agent", id: "agent_priv", name: "Your NodeAgent", scope: "private", ownerId: String(joined.memberId) },
        type: "agent_reply",
        summary: "RILEY-PRIVATE-TRACE private reply",
      });
      // Maya's own private agent trace IS hers to attest — it stays in her bundle.
      await ctx.db.insert("traces", {
        roomId: h.roomId,
        ts: now + 1,
        actor: { kind: "agent", id: "agent_priv", name: "Your NodeAgent", scope: "private", ownerId: String(h.memberId) },
        type: "agent_reply",
        summary: "MAYA-PRIVATE-COACH-TRACE private reply",
      });
      return artifactId;
    });

    const run = await h.t.action(buildEvidenceBundleRef, { roomId: h.roomId, artifactId: h.sheetId, requester: h.proof });
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error("export failed");
    const parts = await readBundleParts(h, run.artifactIds);
    for (const part of parts) {
      expect(part.text).not.toContain("RILEY-SECRET-CELL-99");
      expect(part.text).not.toContain("RILEY-SECRET-NOTE");
      expect(part.text).not.toContain("RILEY-PRIVATE-TRACE");
    }
    const tracePartText = parts[2].text;
    expect(tracePartText).toContain("MAYA-PRIVATE-COACH-TRACE");

    // Maya exporting Riley's PRIVATE sheet directly refuses honestly.
    const denied = await h.t.action(buildEvidenceBundleRef, { roomId: h.roomId, artifactId: rileySheetId, requester: h.proof });
    expect(denied).toEqual({ ok: false, reason: "artifact_not_visible" });

    // The owner CAN attest their own private data.
    const rileyRun = await h.t.action(buildEvidenceBundleRef, {
      roomId: h.roomId,
      artifactId: rileySheetId,
      requester: { actor: rileyActor, token: RILEY_TOKEN },
    });
    expect(rileyRun.ok).toBe(true);
    if (!rileyRun.ok) throw new Error("owner export failed");
    const rileyParts = await readBundleParts(h, rileyRun.artifactIds);
    expect(rileyParts[0].text).toContain("RILEY-SECRET-CELL-99");
  });

  it("bounds: a 25,001-element sheet refuses with sheet_too_large (no partial bundle); a note refuses with not_a_sheet", async () => {
    const h = await seedRoom();
    const hugeId = await h.t.run(async (ctx) => {
      const now = Date.now();
      const order = Array.from({ length: 25_001 }, (_, i) => `r${i}__v`);
      const artifactId = await ctx.db.insert("artifacts", {
        roomId: h.roomId,
        kind: "sheet",
        title: "Oversized import",
        version: 1,
        order,
        updatedAt: now,
        createdBy: h.actor,
        visibility: "room",
      });
      return artifactId;
    });
    const before = await countBundleArtifacts(h);
    const refused = await h.t.action(buildEvidenceBundleRef, { roomId: h.roomId, artifactId: hugeId, requester: h.proof });
    expect(refused).toEqual({ ok: false, reason: "sheet_too_large" });
    const notSheet = await h.t.action(buildEvidenceBundleRef, { roomId: h.roomId, artifactId: h.noteId, requester: h.proof });
    expect(notSheet).toEqual({ ok: false, reason: "not_a_sheet" });
    expect(await countBundleArtifacts(h)).toBe(before);
  });
});
