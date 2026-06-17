/**
 * gen-scale-fixture.mjs — drop a large SYNTHETIC trace record into qaTraceBundles/ to stress-test
 * the Trace tab (Flow graph + Steps list) at scale. The record is clearly labelled synthetic; it is
 * NOT shipped — delete the file when done so real users only ever see real records.
 *
 *   node scripts/qa-trace/gen-scale-fixture.mjs [steps] [phases]
 *   # ...inspect Trace → Scale stress record (Flow + Steps tabs)...
 *   rm src/ui/panels/qaTraceBundles/_scale-stress.json
 *
 * Verified 2026-06-16 at 240 steps / 8 phases: Flow rendered 240 nodes (onlyRenderVisibleElements
 * culls when zoomed), status-coloured minimap + zoom controls present, node-click popped the full
 * StepRow preview (screenshot + highlight box), Steps collapsed into 8 phase accordions, 0 console
 * errors. The graph reads as structure/progression at fit; labels are read by zoom/pan/minimap.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const total = Number(process.argv[2] ?? 240);
const phaseCount = Number(process.argv[3] ?? 8);
const PHASES = ["Ingest sources", "Normalize", "Consolidate", "Reconcile vs golden", "Catch mis-keys", "Variance fill", "Verify", "Queue fixes"].slice(0, phaseCount);
const perPhase = Math.ceil(total / PHASES.length);

const steps = [];
let idx = 0;
for (const g of PHASES) {
  for (let i = 0; i < perPhase && idx < total; i++) {
    idx++;
    const status = idx % 37 === 0 ? "risk" : idx % 11 === 0 ? "warn" : "ok";
    const s = { idx, group: g, label: `${g.split(" ")[0]} op ${i + 1} — entity E${(i % 12) + 1}`, detail: `Tool call ${idx}: processed ledger slice for ${g.toLowerCase()}.`, status };
    if (idx % 25 === 0) s.attachments = [{ kind: "screenshot", url: "/qa-trace/web-source/source.png", label: "captured source", box: { x: 0.18, y: 0.32, w: 0.4, h: 0.06 } }];
    if (idx % 19 === 0) s.attachments = [...(s.attachments ?? []), { kind: "log", text: `read_range(A1:H40) -> 320 cells\nedit_cell(F${i}) ok` }];
    if (idx % 13 === 0) s.metrics = [{ label: "rows", value: String(40 + i) }, { label: "ms", value: String(12 + (idx % 40)) }];
    if (idx % 17 === 0) { s.targetArtifactId = "demo-sheet"; s.targetElementId = `F${i}`; }
    steps.push(s);
  }
}

const rec = {
  id: "scale-stress-synthetic",
  kind: "agent",
  title: `Scale stress · ${steps.length} SYNTHETIC steps`,
  subtitle: "Synthetic fixture — verifies the Flow graph + Steps list stay usable at scale (not real data)",
  ts: "2026-06-16T20:00:00Z",
  source: { tool: "gen-scale-fixture", env: "synthetic" },
  verdict: { label: "Synthetic scale probe", tone: "info" },
  steps,
  raw: { note: "synthetic scale fixture — delete before shipping" },
};

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/ui/panels/qaTraceBundles/_scale-stress.json");
writeFileSync(out, JSON.stringify(rec, null, 2));
console.log(`wrote ${steps.length} steps across ${PHASES.length} phases -> ${out}\nDELETE this file before shipping (synthetic data must not reach real users).`);
