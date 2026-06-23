# Agent-governed columns — `define_columns` with schema-CAS

> The agent decides a tabular artifact's **columns** per task and injects them **through a harness-managed
> tool**, with the **same CAS / no-clobber discipline NodeRoom already uses for cells** — so it is safe
> under simultaneous multi-user + multi-agent editing. The schema becomes a first-class, versioned,
> typed, governed object (not string-parsed from cell ids, not last-writer-wins).

Grounded by the `agent-injected-columns` workflow + its adversarial critic. Why NOT the element-derived
shortcut: columns parsed from `${rowId}__${col}` ids are untyped, order-by-race, and **ungoverned** —
two agents diverge on column names with no CAS, breaking the no-clobber premise. Frontier systems
(Notion/Airtable AI, structured outputs) define **explicit typed schemas**; collaborative systems
(Google Sheets/Notion) version + CAS the schema. We extend our existing cell-CAS up to the schema.

## 0. The principle: govern the schema exactly like a cell
Cell writes go through `lock → CAS(per-element version) → policy` (convex/artifacts.ts:571-640).
The schema gets the **same shape**, keyed on the **artifact version** as its CAS token:

```
agent: snapshot() → baseVersion = art.version
       define_columns({ baseVersion, columns:[…] })
         └─ ok                       → fill rows with write_locked_cell `${rowId}__${colId}`
         └─ { conflict, expected, actual } → re-snapshot, retry   (the harness's existing CAS-as-result loop)
```

No new coordination primitive — `define_columns` returns a CAS conflict as a **tool result** (data),
which the runtime already knows how to feed back so the model re-reads and retries (runtime.ts).

## 1. The typed column (already exists)
`DataframeColumn` (src/engine/types.ts:96): `{ id, label, order, mode?, type?, agentWritable? }`.
The agent supplies **label + type + agentWritable**; the system assigns **id (slug of label)** and
**order (array index)** — the model never hand-numbers order (the PR #39 cheap-model hardening lesson).

## 2. The tool (harness seam 3) — `cellMutator.ts`, added to `PRODUCTION_ROOM_TOOLS`
```ts
const MAX_COLUMNS = 64;
const DEFINE_COLUMNS_TOOL: AgentTool = {
  name: "define_columns",
  description:
    "Declare/replace the COLUMNS (schema) of a tabular sheet BEFORE filling rows. You decide the columns " +
    "for the task. CAS-guarded: pass baseVersion (the artifact version from snapshot); if it returns " +
    "{conflict}, re-read the snapshot and call again. Then fill rows with write_locked_cell keyed `${rowId}__${columnId}`.",
  schema: z.object({
    artifactId: z.string().optional(),                 // defaults to the primary sheet
    baseVersion: z.coerce.number(),                    // CAS token = artifact version
    mode: z.enum(["replace", "merge"]).default("merge"),
    columns: tolerantArray(                            // PR #39 tolerance for cheap models
      z.object({
        label: z.string().min(1).max(80),
        type: z.enum(["text","number","date","currency","boolean","json"]).default("text"),
        agentWritable: z.coerce.boolean().default(true),
      }),
      { min: 1, max: MAX_COLUMNS },                     // BOUND
    ),
  }),
  execute: async (args, rt) => {
    if (!rt.setColumns) return { ok: false, error: "schema editing is unavailable in this runtime" };
    return rt.setColumns(args);                         // → RoomTools port
  },
};
```
Mirrors `SET_ARTIFACT_META_TOOL` (cellMutator.ts:866) for the unavailable-runtime fallback. `set_artifact_meta`
stays as-is (title/summary/tags); columns are **schema** (versioned + traced like elements), not OKF metadata.

## 3. The port (harness seam 2) — `RoomTools` in `core/types.ts:132`
```ts
setColumns?(args: {
  artifactId?: string; baseVersion: number; mode: "replace" | "merge";
  columns: Array<{ label: string; type: string; agentWritable: boolean }>;
}): Promise<
  | { ok: true; version: number; columns: DataframeColumn[] }
  | { ok: false; conflict: true; expected: number; actual: number }   // CAS conflict-as-RESULT
  | { ok: false; error: string }
>;
```
Optional (like `setArtifactMeta?`). Two impls, identical contract: `InMemoryRoomTools` (engine) + `ConvexRoomTools`.

## 4. The single normalizer (one source of truth — used by create + seed + setColumns)
```ts
// shared (engine + convex import the SAME helper so id/order/BOUND rules cannot drift — critic risk[1])
function normalizeColumns(input, existing: DataframeColumn[] = []): DataframeColumn[] {
  const base = mode === "merge" ? mergeById(existing, input) : input;   // merge: upsert by id; replace: input only
  const out: DataframeColumn[] = [];
  for (const c of base.slice(0, MAX_COLUMNS)) {                          // BOUND count
    const id = dedupe(slug(c.label, 64), out);                          // slug, ≤64, dedupe (append -2)
    out.push({ id, label: c.label.slice(0, 80), order: out.length, type: c.type ?? "text", agentWritable: c.agentWritable ?? true });
  }
  return out;
}
```

## 5. Engine — `RoomEngine.setColumns` (roomEngine.ts, beside setArtifactMeta:187)
```ts
setColumns(a): SetColumnsOutcome {
  const art = this.getArtifact(a.artifactId); if (!art || art.kind !== "sheet") return { ok:false, error:"not a sheet" };
  if (art.version !== a.baseVersion) return { ok:false, conflict:true, expected:a.baseVersion, actual:art.version }; // CAS
  const cols = normalizeColumns(a.columns, a.mode === "merge" ? art.meta.dataframe?.columns ?? [] : []);
  if (a.mode === "replace") this.pruneOrphanCells(art, cols);          // delete `${rid}__${droppedCol}` + trim art.order (orphan rule = delete)
  art.meta = { ...art.meta, dataframe: { ...art.meta.dataframe, columns: cols } };
  art.version++; art.updatedAt = this.now();
  this.trace(art.roomId, a.by, "schema_changed", { artifactId: art.id, count: cols.length }); // add to TraceType union (types.ts:366)
  this.emit();
  return { ok:true, version: art.version, columns: cols };
}
```

## 6. Convex — `setColumnsByAgent` internalMutation (artifacts.ts, beside setArtifactMetaByAgent:868)
```ts
export const setColumnsByAgent = internalMutation({
  args: { roomId, artifactId, baseVersion: v.number(), mode, columns, actor },
  handler: async (ctx, a) => {
    await requireActorInRoom(ctx, a.roomId, a.actor);                   // membership, NOT owner-gated (agents edit schema)
    const art = await ctx.db.get(a.artifactId);
    if (!art || art.kind !== "sheet") return { ok:false, error:"not a sheet" };
    if (art.version !== a.baseVersion) return { ok:false, conflict:true, expected:a.baseVersion, actual:art.version }; // CAS (mutation is transactional → safe re-read for merge)
    const cols = normalizeColumns(a.columns, a.mode === "merge" ? art.meta?.dataframe?.columns ?? [] : []);
    if (a.mode === "replace") await pruneOrphanElements(ctx, a.artifactId, cols);
    await ctx.db.patch(a.artifactId, { meta: { ...art.meta, dataframe: { ...art.meta?.dataframe, columns: cols } }, version: art.version + 1, updatedAt: Date.now() });
    await ctx.db.insert("traces", { roomId: a.roomId, type: "schema_changed", actor: a.actor, detail: { artifactId: a.artifactId, count: cols.length }, at: Date.now() });
    return { ok:true, version: art.version + 1, columns: cols };
  },
});
```
`ConvexRoomTools.setColumns` → `runMutation(setColumnsByAgentRef, …)`, translating its result to the RoomTools shape (the same mapping pattern convexRoomTools already uses for cell conflicts).

## 7. Declare-then-fill enforcement (critic P0 — the cited gate does NOT exist today)
`agentWritePolicyViolation` (artifacts.ts:357) returns `null` for an unknown column → undeclared-column
writes currently **succeed as invisible orphans on both lanes**. Close the hole so the typed schema is real:
- Extend `agentWritePolicyViolation` (and the engine policy check): if an agent `set`/`create` targets
  `elementId` whose `colId` (split on `__`) is **not in** `meta.dataframe.columns`, return `no_such_column`
  → the cell write fails with a clear result, and the agent must `define_columns` first. Enforce on **both** lanes.
- This makes "declare schema → fill rows" actually enforceable + keeps the table honest (no silent orphans).

## 8. The render surface — port the overlay into `GenericSheet` (critic P0)
Research renders via `GenericSheet` (Artifact.tsx:932) — a **static read-only table with no overlay/edit**.
The Attention Overlay is wired only in `ExcelGridSheet` (A1 `${c}${r}` keys — **incompatible** with the
`${rid}__${col}` convention). So:
- `GenericSheet({ art })` → `GenericSheet({ roomId, me, art, onError })`; add the overlay hooks (resolver over
  `.r-sheet-wrap`, `focusBoxesForSheet` from presence/locks/drafts/evidence keyed `${rid}__${col}`, mount
  `<AttentionOverlay>`) — the SAME pattern as the variance `Sheet` renderer, on the `__` key space. Do NOT
  route research through ExcelGridSheet.
- `columnsOf` (Artifact.tsx:1425) already renders `meta.dataframe.columns` dynamically; verify a **meta-only**
  patch yields a fresh client `art` object so `GenericSheet`'s `useMemo([art])` re-runs (post-B1-Phase-2,
  columns propagate via the rooms.meta hash, not a version field in the projection — confirm the store.tsx merge).

## 9. Seed: research opens blank, agent structures it
`demoRoom.researchMeta()` → `dataframe.columns: []` (or a 1-col `company` stub), `rowCount: 0`. Audit the
Convex starter `STARTUP_RESEARCH_COLS` (rooms.ts:50) and the blank-room A/B/C hardcode (Artifact.tsx:273)
so a fresh prod room also opens blank.

## 10. Tests (scenario-based, multi-agent — the whole point)
- **Concurrent schema (CAS holds):** two agents `define_columns` with the same `baseVersion` → exactly one
  `ok`, the other `{conflict, expected, actual}`; retry-after-resnapshot succeeds. Run on **both** memory + Convex lanes.
- **Declare-then-fill:** agent `write_locked_cell` to an undeclared col → `{ok:false, no_such_column}` (both lanes).
- **BOUND:** `define_columns` with 200 cols / a 50KB label → capped at `MAX_COLUMNS`, label clamped.
- **Re-render:** `define_columns` with NO cell edit → client `art.meta.dataframe.columns` updates and `GenericSheet`
  shows the new headers (catches the post-B1 meta-only-propagation bug).
- **Overlay:** after the GenericSheet port, an agent_write/evidence box lands on `${rid}__${col}` in research.

## 11. Files
`core/types.ts` (RoomTools.setColumns + types) · `cellMutator.ts` (DEFINE_COLUMNS_TOOL + register) ·
`roomEngine.ts` (setColumns + normalizeColumns + pruneOrphanCells + policy gate) · `engine/types.ts`
(TraceType += schema_changed) · `convex/artifacts.ts` (setColumnsByAgent + agentWritePolicyViolation gate +
shared normalizeColumns) · `convex/convexRoomTools.ts` (setColumns) · `demoRoom.ts` + `convex/rooms.ts`
(empty seed) · `Artifact.tsx` (GenericSheet overlay port) · `tests/` (the 5 scenarios above).

## 12. Net
One typed tool + one CAS-guarded port method + one shared normalizer — every heavy primitive (CAS version,
trace, `columnsOf` rendering, cell writes) is reused. The schema is governed exactly like a cell, so it is
**frontier-grade (explicit typed schema) AND safe under simultaneous multi-user + multi-agent collaboration.**
