/**
 * Seed Notion SDR/BDR demo data — loads lead/pipeline/meeting data into proof-loop.
 *
 * Usage: npx tsx proofloop/notion/seed-datasets.ts
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const dataDir = join(process.cwd(), "proofloop", "notion", "data");
const FIXTURE_GENERATED_AT = "2026-07-01T00:00:00.000Z";
mkdirSync(dataDir, { recursive: true });

function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// Load existing data files (they were created as fixtures)
const leads = readFileSync(join(dataDir, "leads.json"), "utf-8");
const callNotes = readFileSync(join(dataDir, "discovery-call-notes.json"), "utf-8");
const pipeline = readFileSync(join(dataDir, "pipeline.json"), "utf-8");
const meetings = readFileSync(join(dataDir, "meetings.json"), "utf-8");

const registry = {
  datasets: [
    { name: "leads", source: "local-fixture", task: "warm_intro", license_checked: true, checksum: checksum(leads), description: "5 sample leads for SDR warm intro scenario" },
    { name: "discovery-call-notes", source: "local-fixture", task: "follow_up", license_checked: true, checksum: checksum(callNotes), description: "Discovery call notes for follow-up scenario" },
    { name: "pipeline", source: "local-fixture", task: "automated_pipeline", license_checked: true, checksum: checksum(pipeline), description: "5 prospects across different pipeline stages" },
    { name: "meetings", source: "local-fixture", task: "meeting_prep", license_checked: true, checksum: checksum(meetings), description: "3 executive discovery calls for meeting prep" },
  ],
  generatedAt: FIXTURE_GENERATED_AT,
};

writeFileSync(join(dataDir, "dataset-registry.json"), JSON.stringify(registry, null, 2), "utf-8");

console.log(`seed-datasets: ✅ ${registry.datasets.length} Notion SDR/BDR datasets seeded`);
console.log(`seed-datasets: registry at ${join(dataDir, "dataset-registry.json")}`);
