#!/usr/bin/env node
/**
 * Package a long-run agent workspace proof into a reviewable, hash-bound folder.
 *
 *   node scripts/agent-workspace-proof-package.mjs <proofDir> [--verifier <path>]
 *
 * Inputs (written by e2e/agent-workspace/long-run.proof.spec.ts): recording.json,
 * raw-recording.webm, trace.zip, events/*.jsonl, runs/*.json, project.json, screenshots/.
 * Outputs: raw-recording.mp4 (same footage, 1x), timeline.json (every backend
 * event mapped to a video offset), highlights.mp4 (milestone cuts, labelled,
 * disclosed as edited), timelapse.mp4 (whole run sped up, disclosed),
 * contact-sheet.png, verification-rerun.json, manifest.json, README.md.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(process.argv[2] ?? "");
if (!process.argv[2] || !existsSync(join(dir, "recording.json"))) {
  console.error("usage: agent-workspace-proof-package.mjs <proofDir>  (recording.json not found)");
  process.exit(2);
}
const argVerifier = process.argv.indexOf("--verifier");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifier = argVerifier > 0 ? resolve(process.argv[argVerifier + 1]) : join(repoRoot, "packages/nodeagent-engines/fixtures/verifiers/diligence-pack.verify.mjs");
const FONT = process.platform === "win32" ? "C\\:/Windows/Fonts/segoeui.ttf" : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 6).join(" ")} … failed (${r.status}): ${(r.stderr || "").slice(-1500)}`);
  return r.stdout;
}
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const esc = (t) => t.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%").replace(/,/g, "\\,");

const recording = JSON.parse(readFileSync(join(dir, "recording.json"), "utf8"));
const t0 = Date.parse(recording.recordingStartedAt);

// 1. Same footage as mp4 (1x, unedited).
const webm = join(dir, recording.video ?? "raw-recording.webm");
const mp4 = join(dir, "raw-recording.mp4");
if (existsSync(webm) && !existsSync(mp4)) {
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
}
const duration = existsSync(mp4)
  ? Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", mp4]).trim())
  : 0;

// 2. Backend events -> video offsets. Token deltas and raw engine frames are counted, not listed.
const runs = {};
for (const f of existsSync(join(dir, "runs")) ? readdirSync(join(dir, "runs")) : []) runs[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, "runs", f), "utf8"));
const timeline = [];
const eventCounts = {};
for (const f of existsSync(join(dir, "events")) ? readdirSync(join(dir, "events")) : []) {
  for (const line of readFileSync(join(dir, "events", f), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;
    if (e.type === "message.delta" || e.type === "engine.raw") continue;
    const label =
      e.type === "tool.call" ? `${e.native ? "native" : "node"} tool ${e.name}` :
      e.type === "helper.started" ? `helper started: ${e.description}` :
      e.type === "helper.completed" ? `helper ${e.status}: ${e.helperId}` :
      e.type === "context.compacted" ? `context compacted ${e.preTokens}→${e.postTokens ?? "?"} (${e.trigger})` :
      e.type === "skill.lifecycle" ? `skill ${e.name} ${e.stage}` :
      e.type === "skill.loaded" ? `skill loaded ${e.name}` :
      e.type === "tool.loaded" ? `tools loaded ${e.names.join(", ")}` :
      e.type === "check.result" ? `${e.independent ? "independent " : ""}check ${e.ok ? "passed" : "failed"} (${e.passed}/${e.passed + e.failed})` :
      e.type;
    timeline.push({ runId: e.runId, seq: e.seq, ts: e.ts, type: e.type, agentId: e.agentId ?? null, videoOffsetSec: Math.round((Date.parse(e.ts) - t0) / 100) / 10, label });
  }
}
timeline.sort((a, b) => a.videoOffsetSec - b.videoOffsetSec || a.seq - b.seq);
writeFileSync(join(dir, "timeline.json"), JSON.stringify({ schema: "nodeagent.proof-timeline/v1", recordingStartedAt: recording.recordingStartedAt, videoDurationSec: duration, eventCounts, events: timeline }, null, 1));

// 3. Highlights: milestone windows from the raw footage, labelled. Edited footage, disclosed.
const milestones = (recording.milestones ?? []).filter((m) => m.videoOffsetSec <= duration);
const windows = [];
for (const m of milestones) {
  const start = Math.max(0, m.videoOffsetSec - 3);
  const end = Math.min(duration, m.videoOffsetSec + 7);
  const last = windows[windows.length - 1];
  if (last && start <= last.end) { last.end = Math.max(last.end, end); last.labels.push(m.name); }
  else windows.push({ start, end, labels: [m.name] });
}
if (existsSync(mp4) && windows.length) {
  const parts = windows.map((w, i) =>
    `[0:v]trim=start=${w.start}:end=${w.end},setpts=PTS-STARTPTS,drawtext=fontfile='${FONT}':text='${esc(`raw ${mmss(w.start)}–${mmss(w.end)} · ${w.labels.join(" · ")}`)}':x=24:y=h-48:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8[v${i}]`);
  const concat = `${windows.map((_, i) => `[v${i}]`).join("")}concat=n=${windows.length}:v=1:a=0[out]`;
  writeFileSync(join(dir, "highlights.filter.txt"), [...parts, concat].join(";\n"));
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-filter_complex_script", join(dir, "highlights.filter.txt"), "-map", "[out]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", join(dir, "highlights.mp4")]);
}

// 4. Time-lapse of the entire run, at most ~3 minutes. Disclosed in the frame.
let timelapseFactor = null;
if (existsSync(mp4) && duration > 0) {
  timelapseFactor = Math.max(1, Math.ceil(duration / 180));
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-vf",
    `setpts=PTS/${timelapseFactor},fps=15,drawtext=fontfile='${FONT}':text='${esc(`time-lapse ×${timelapseFactor} of the unedited recording`)}':x=24:y=24:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8`,
    "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", join(dir, "timelapse.mp4")]);
}

// 5. Contact sheet of milestone screenshots.
const shots = existsSync(join(dir, "screenshots")) ? readdirSync(join(dir, "screenshots")).filter((f) => f.endsWith(".png")).sort() : [];
if (shots.length) {
  const cols = 4;
  const rows = Math.ceil(shots.length / cols);
  const list = join(dir, "contact-sheet.inputs.txt");
  writeFileSync(list, shots.map((s) => `file '${join(dir, "screenshots", s).replace(/\\/g, "/")}'`).join("\n"));
  run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=480:300,tile=${cols}x${rows}:padding=6:color=0x111111`, "-frames:v", "1", join(dir, "contact-sheet.png")]);
}

// 6. Re-run the independent verifier against the saved workspace, outside the worker.
let rerun = null;
const project = existsSync(join(dir, "project.json")) ? JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) : null;
if (project?.workspaceDir && existsSync(verifier)) {
  const r = spawnSync(process.execPath, [verifier, project.workspaceDir, "--json"], { encoding: "utf8", timeout: 300_000 });
  try { rerun = JSON.parse(r.stdout); } catch { rerun = { error: `verifier exit ${r.status}`, stderr: (r.stderr || "").slice(-2000) }; }
  writeFileSync(join(dir, "verification-rerun.json"), JSON.stringify(rerun, null, 2));
}

// 7. Manifest with hashes, versions, usage.
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== "playwright" && f !== "video-raw") walk(p); }
    else if (f !== "manifest.json" && f !== "README.md") files.push({ path: relative(dir, p).replace(/\\/g, "/"), bytes: statSync(p).size, sha256: sha256(p) });
  }
};
walk(dir);
const enginePkg = JSON.parse(readFileSync(join(repoRoot, "packages/nodeagent-engines/package.json"), "utf8"));
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean).length;
const runSummaries = Object.values(runs).map((r) => ({
  id: r.id, engine: r.engine, model: r.model, helperModel: r.helperModel ?? null, status: r.status, relation: r.relation ?? null, parentRunId: r.parentRunId ?? null,
  createdAt: r.createdAt, endedAt: r.endedAt ?? null, usage: r.usage, counters: r.counters, verification: r.verification ?? null,
}));
const totalCost = runSummaries.reduce((s, r) => (r.usage?.costUsd == null || s == null ? null : s + r.usage.costUsd), 0);
const manifest = {
  schema: "nodeagent.proof-package/v1",
  generatedAt: new Date().toISOString(),
  // Captured when packaging, not when recording; recording.json may carry the recording-time head.
  source: { gitHeadAtPackaging: head, dirtyFilesAtPackaging: dirty, gitHeadAtRecording: recording.gitHead ?? null, package: `${enginePkg.name}@${enginePkg.version}`, sdkPins: enginePkg.dependencies },
  recording: { startedAt: recording.recordingStartedAt, endedAt: recording.endedAt, durationSec: duration, rawVideo: "raw-recording.webm", rawVideoMp4: "raw-recording.mp4", speed: "1x unedited", trace: "trace.zip" },
  editedMedia: { highlights: windows.length ? { file: "highlights.mp4", edited: true, windows } : null, timelapse: timelapseFactor ? { file: "timelapse.mp4", speedFactor: timelapseFactor } : null },
  runs: runSummaries,
  totalCostUsd: totalCost,
  eventCounts,
  milestones: recording.milestones,
  verificationRerun: rerun,
  files,
};
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
mkdirSync(dir, { recursive: true });
console.log(JSON.stringify({ duration, events: timeline.length, milestones: milestones.length, highlights: windows.length, timelapseFactor, totalCost, verification: rerun && { passed: rerun.passed, failed: rerun.failed } }));
