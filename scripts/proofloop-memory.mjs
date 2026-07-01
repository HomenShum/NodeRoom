#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const PROOFLOOP_DIR = join(ROOT, ".proofloop");
const RUNS_DIR = join(PROOFLOOP_DIR, "runs");
const MEMORY_DIR = join(PROOFLOOP_DIR, "memory");
const COMPACTED_DIR = join(MEMORY_DIR, "compacted");
const INDEX_PATH = join(MEMORY_DIR, "index.db");
const POLICY_PATH = join(MEMORY_DIR, "policies.json");
const MEMORY_JSONL = join(MEMORY_DIR, "memory.jsonl");
const LEGACY_MEMORY_JSONL = join(PROOFLOOP_DIR, "memory.jsonl");
const REDACTION_LOG = join(MEMORY_DIR, "redaction.log");

const DEFAULT_POLICY = {
  mode: "local-first",
  rawTraceRetentionDays: 7,
  rawVideoRetentionDays: 7,
  storeRawTranscripts: false,
  storeScreenshots: "path-only",
  storeVideos: "path-only",
  scrubSecrets: true,
  scrubPII: true,
  cloudSync: false,
  enterpriseSync: {
    enabled: false,
    backend: "customer-owned",
  },
};

const FAILURE_CATEGORIES = new Set([
  "model_reasoning",
  "fusion_router",
  "context_pack",
  "tool_schema",
  "ui_affordance",
  "app_state",
  "artifact_generation",
  "verifier_feedback",
  "visual_design",
  "cost_budget",
  "latency",
  "memory_recall",
  "prod_app_bug",
  "proofloop_gap",
]);

main();

function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "init":
      return cmdInit();
    case "compact":
      return cmdCompact(args[0]);
    case "index":
      return cmdIndex();
    case "search":
      return cmdSearch(args);
    case "show":
      return cmdShow(args[0]);
    case "export":
      return cmdExport(args);
    case "doctor":
      return cmdDoctor();
    case undefined:
    case "--help":
    case "-h":
      return usage();
    default:
      return usage(`unknown memory command: ${command}`);
  }
}

function usage(error) {
  if (error) console.error(`proofloop memory: ${error}\n`);
  console.log([
    "Usage: proofloop memory <command> [args]",
    "",
    "  init                         create local-first memory layout",
    "  compact [runId|latest]        compact one proof run into episode memory",
    "  index                         build .proofloop/memory/index.db with SQLite + FTS5",
    "  search <query> [--suite=x]    search compacted memories",
    "  show <memory-id>              print one compacted memory episode",
    "  export --redacted [--out=x]   export redacted compacted memory",
    "  doctor                        verify policy, compacted files, and FTS index",
  ].join("\n"));
  process.exitCode = error ? 1 : 0;
}

function cmdInit() {
  ensureMemoryLayout();
  console.log(`proofloop memory: initialized ${rel(MEMORY_DIR)}`);
  console.log(`proofloop memory: policy ${rel(POLICY_PATH)}`);
  console.log(`proofloop memory: index ${rel(INDEX_PATH)}`);
}

function cmdCompact(runArg) {
  ensureMemoryLayout();
  const runDir = resolveRunDir(runArg);
  if (!runDir) {
    console.error(`proofloop memory: no run found for "${runArg ?? "latest"}"`);
    process.exitCode = 1;
    return;
  }
  const episode = compactRun(runDir);
  upsertJsonl(join(COMPACTED_DIR, "episodes.jsonl"), episode, "id");
  upsertJsonl(MEMORY_JSONL, episode, "id");
  if (episode.failure) upsertJsonl(join(COMPACTED_DIR, "failures.jsonl"), episode, "id");
  if (episode.failure?.fixSummary) {
    upsertJsonl(join(COMPACTED_DIR, "scaffold-deltas.jsonl"), scaffoldDeltaFromEpisode(episode), "id");
  }
  upsertJsonl(join(COMPACTED_DIR, "model-deltas.jsonl"), modelDeltaFromEpisode(episode), "id");
  appendRedactionLog({
    type: "compact",
    memoryId: episode.id,
    runId: episode.runId,
    redaction: "secret/email/private-url regex scrub applied to searchable fields; screenshots/videos stored path-only",
  });
  console.log(`proofloop memory: compacted ${basename(runDir)} -> ${episode.id}`);
}

function cmdIndex() {
  ensureMemoryLayout();
  const episodes = readJsonl(join(COMPACTED_DIR, "episodes.jsonl"));
  const db = openDb();
  db.exec("DELETE FROM memories");
  const insert = db.prepare(`
    INSERT INTO memories (
      id, run_id, repo, app, suite, goal, model_policy, harness_version,
      passed, score, cost_usd, failure_category, symptom, root_cause,
      fix_summary, evidence_json, searchable_text, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    for (const episode of episodes) {
      insert.run(
        episode.id,
        episode.runId,
        episode.repo,
        episode.app,
        episode.suite,
        episode.goal,
        episode.modelPolicy,
        episode.harnessVersion,
        episode.outcome?.passed ? 1 : 0,
        Number(episode.outcome?.score ?? 0),
        nullableNumber(episode.outcome?.costUsd),
        episode.failure?.category ?? null,
        episode.failure?.symptom ?? null,
        episode.failure?.rootCause ?? null,
        episode.failure?.fixSummary ?? null,
        JSON.stringify(episode.evidenceRefs ?? {}),
        episode.searchableText ?? "",
        episode.createdAt,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')");
  db.close();
  appendRedactionLog({ type: "index", episodeCount: episodes.length, index: rel(INDEX_PATH) });
  console.log(`proofloop memory: indexed ${episodes.length} episode(s) into ${rel(INDEX_PATH)}`);
}

function cmdSearch(args) {
  ensureMemoryLayout();
  if (!existsSync(INDEX_PATH)) cmdIndex();
  const { query, suite, app, limit } = parseSearchArgs(args);
  if (!query) return usage("search requires a query");
  const db = openDb();
  const ftsQuery = toFtsQuery(query);
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT memories.*, bm25(memories_fts) AS fts_rank
      FROM memories_fts
      JOIN memories ON memories_fts.rowid = memories.rowid
      WHERE memories_fts MATCH ?
    `).all(ftsQuery);
  } catch {
    const like = `%${query.replace(/[%_]/g, "")}%`;
    rows = db.prepare(`
      SELECT *, 0 AS fts_rank
      FROM memories
      WHERE searchable_text LIKE ? OR goal LIKE ? OR suite LIKE ? OR failure_category LIKE ?
    `).all(like, like, like, like);
  }
  db.close();
  const now = Date.now();
  const ranked = rows
    .filter((row) => !suite || row.suite === suite)
    .filter((row) => !app || String(row.app).toLowerCase() === app.toLowerCase())
    .map((row) => ({
      ...row,
      score_rank: rankMemory(row, { query, suite, app, now }),
    }))
    .sort((a, b) => b.score_rank - a.score_rank)
    .slice(0, limit);
  if (!ranked.length) {
    console.log("proofloop memory: no matching memories");
    return;
  }
  for (const row of ranked) {
    console.log([
      `${row.id}  ${row.passed ? "pass" : "fail"} score=${row.score}`,
      `suite=${row.suite} policy=${row.model_policy}`,
      row.failure_category ? `failure=${row.failure_category}` : "failure=none",
      row.fix_summary ? `fix=${row.fix_summary}` : `goal=${row.goal}`,
      `evidence=${row.evidence_json}`,
    ].join("\n  "));
  }
}

function cmdShow(memoryId) {
  ensureMemoryLayout();
  if (!memoryId) return usage("show requires a memory id");
  const found = readJsonl(join(COMPACTED_DIR, "episodes.jsonl")).find((episode) => episode.id === memoryId);
  if (!found) {
    console.error(`proofloop memory: no memory found for ${memoryId}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(found, null, 2));
}

function cmdExport(args) {
  ensureMemoryLayout();
  const redacted = args.includes("--redacted");
  if (!redacted) return usage("export currently requires --redacted");
  const out = optionValue(args, "--out") ?? join(MEMORY_DIR, "export-redacted.json");
  const payload = {
    schema: 1,
    exportedAt: new Date().toISOString(),
    policy: readJson(POLICY_PATH, DEFAULT_POLICY),
    episodes: readJsonl(join(COMPACTED_DIR, "episodes.jsonl")),
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  appendRedactionLog({ type: "export", out: rel(out), redacted: true });
  console.log(`proofloop memory: wrote ${rel(out)}`);
}

function cmdDoctor() {
  ensureMemoryLayout();
  const report = {
    schema: 1,
    checkedAt: new Date().toISOString(),
    memoryDir: rel(MEMORY_DIR),
    policyExists: existsSync(POLICY_PATH),
    indexExists: existsSync(INDEX_PATH),
    compacted: {
      episodes: readJsonl(join(COMPACTED_DIR, "episodes.jsonl")).length,
      failures: readJsonl(join(COMPACTED_DIR, "failures.jsonl")).length,
      scaffoldDeltas: readJsonl(join(COMPACTED_DIR, "scaffold-deltas.jsonl")).length,
      modelDeltas: readJsonl(join(COMPACTED_DIR, "model-deltas.jsonl")).length,
    },
    sqlite: sqliteDoctor(),
    redactionLogExists: existsSync(REDACTION_LOG),
    cloudSync: readJson(POLICY_PATH, DEFAULT_POLICY).cloudSync === true,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.policyExists || !report.redactionLogExists || report.cloudSync) process.exitCode = 1;
}

function ensureMemoryLayout() {
  mkdirSync(COMPACTED_DIR, { recursive: true });
  for (const file of ["episodes.jsonl", "failures.jsonl", "scaffold-deltas.jsonl", "model-deltas.jsonl"]) {
    const path = join(COMPACTED_DIR, file);
    if (!existsSync(path)) writeFileSync(path, "", "utf-8");
  }
  if (!existsSync(POLICY_PATH)) writeJson(POLICY_PATH, DEFAULT_POLICY);
  if (!existsSync(MEMORY_JSONL)) writeFileSync(MEMORY_JSONL, "", "utf-8");
  if (!existsSync(REDACTION_LOG)) writeFileSync(REDACTION_LOG, "", "utf-8");
  const db = openDb();
  db.close();
}

function openDb() {
  mkdirSync(MEMORY_DIR, { recursive: true });
  const db = new DatabaseSync(INDEX_PATH);
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      repo TEXT,
      app TEXT,
      suite TEXT,
      goal TEXT,
      model_policy TEXT,
      harness_version TEXT,
      passed INTEGER,
      score REAL,
      cost_usd REAL,
      failure_category TEXT,
      symptom TEXT,
      root_cause TEXT,
      fix_summary TEXT,
      evidence_json TEXT,
      searchable_text TEXT,
      created_at TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      goal,
      suite,
      model_policy,
      failure_category,
      symptom,
      root_cause,
      fix_summary,
      searchable_text,
      content='memories',
      content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, goal, suite, model_policy, failure_category, symptom, root_cause, fix_summary, searchable_text)
      VALUES (new.rowid, new.goal, new.suite, new.model_policy, new.failure_category, new.symptom, new.root_cause, new.fix_summary, new.searchable_text);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, goal, suite, model_policy, failure_category, symptom, root_cause, fix_summary, searchable_text)
      VALUES('delete', old.rowid, old.goal, old.suite, old.model_policy, old.failure_category, old.symptom, old.root_cause, old.fix_summary, old.searchable_text);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, goal, suite, model_policy, failure_category, symptom, root_cause, fix_summary, searchable_text)
      VALUES('delete', old.rowid, old.goal, old.suite, old.model_policy, old.failure_category, old.symptom, old.root_cause, old.fix_summary, old.searchable_text);
      INSERT INTO memories_fts(rowid, goal, suite, model_policy, failure_category, symptom, root_cause, fix_summary, searchable_text)
      VALUES (new.rowid, new.goal, new.suite, new.model_policy, new.failure_category, new.symptom, new.root_cause, new.fix_summary, new.searchable_text);
    END;
  `);
  return db;
}

function compactRun(runDir) {
  const runResult = readJson(join(runDir, "run-result.json"), {});
  const meta = readJson(join(runDir, "meta.json"), {});
  const trace = readJson(join(runDir, "node-trace-v2.json"), {});
  const nodeEval = readJson(join(runDir, "node-eval.json"), {});
  const verifier = readJson(join(runDir, "verifier-receipt.json"), {});
  const comparison = readJson(join(runDir, "model-comparison.json"), {});
  const cost = readJson(join(runDir, "cost-ledger.json"), {});
  const liveContract = readJson(join(runDir, "live-user-contract.json"), {});
  const suite = scrub(runResult.suite ?? meta.suite ?? trace.suite ?? verifier.suite ?? comparison.suite ?? "unknown");
  const runId = scrub(runResult.runId ?? meta.runId ?? trace.runId ?? verifier.runId ?? basename(runDir));
  const winningPolicy = comparison.winner ?? trace.agent_state?.policiesCompared?.find((policy) => policy.passed)?.policy ?? "unknown";
  const weakPolicy = comparison.policies?.find((policy) => policy.passed === false) ?? trace.agent_state?.policiesCompared?.find((policy) => policy.passed === false);
  const passed = Boolean(runResult.passed ?? meta.passed ?? verifier.passed ?? liveContract.valid);
  const score = Number(runResult.score ?? meta.score ?? nodeEval.reward?.total ?? verifier.score ?? 0);
  const failureCategory = normalizeFailureCategory(weakPolicy?.failureLayer ?? nodeEval.reward?.failureCategories?.[0] ?? (passed ? undefined : "proofloop_gap"));
  const fixSummary = weakPolicy?.recommendedScaffoldChange ?? textFirstLine(readMaybe(join(runDir, "model-delta.md"))) ?? undefined;
  const symptom = passed ? "No failing proof gate in latest run." : (runResult.failReasons?.join("; ") || meta.failedGates?.join("; ") || "Proof Loop run failed.");
  const evidenceRefs = {
    scorecard: existsSync(join(runDir, "scorecard.md")) ? "scorecard.md" : undefined,
    nodeTraceV2: existsSync(join(runDir, "node-trace-v2.json")) ? "node-trace-v2.json" : undefined,
    video: existsSync(join(runDir, "videos", "final-proximitty-demo.mp4")) ? "videos/final-proximitty-demo.mp4" : trace.browser_state?.video,
    screenshot: trace.browser_state?.screenshots?.[0] ?? firstExistingScreenshot(runDir),
    verifierReceipt: existsSync(join(runDir, "verifier-receipt.json")) ? "verifier-receipt.json" : undefined,
  };
  const searchableText = scrub([
    trace.user_goal,
    suite,
    winningPolicy,
    "proofloop memory recall failure scaffold model delta artifact generation verifier evidence",
    `failure category ${failureCategory ?? "none"}`,
    symptom,
    weakPolicy?.failureLayer,
    fixSummary,
    JSON.stringify(verifier.checks ?? {}),
    JSON.stringify(liveContract.gates ?? {}),
  ].filter(Boolean).join("\n"));
  return {
    id: memoryId(runId, suite),
    runId,
    repo: scrub(repoId()),
    app: scrub(trace.agent_state?.app ?? "noderoom"),
    suite,
    goal: scrub(trace.user_goal ?? meta.cmd ?? `${suite} proof run`),
    modelPolicy: scrub(winningPolicy),
    harnessVersion: scrub(suite),
    outcome: {
      passed,
      score,
      costUsd: nullableNumber(cost.totalCostUsd ?? comparison.costSummary?.totalCostUsd),
      durationMs: nullableNumber(runResult.durationMs ?? meta.durationMs ?? comparison.costSummary?.maxDurationMs),
    },
    failure: failureCategory ? {
      category: failureCategory,
      symptom: scrub(symptom),
      rootCause: scrub(weakPolicy?.failureLayer ? `Lagging layer: ${weakPolicy.failureLayer}` : ""),
      fixSummary: scrub(fixSummary ?? ""),
    } : undefined,
    evidenceRefs,
    searchableText,
    createdAt: new Date().toISOString(),
  };
}

function scaffoldDeltaFromEpisode(episode) {
  return {
    id: `${episode.id}:scaffold`,
    memoryId: episode.id,
    runId: episode.runId,
    suite: episode.suite,
    failureCategory: episode.failure?.category,
    fixSummary: episode.failure?.fixSummary,
    evidenceRefs: episode.evidenceRefs,
    createdAt: episode.createdAt,
  };
}

function modelDeltaFromEpisode(episode) {
  return {
    id: `${episode.id}:model`,
    memoryId: episode.id,
    runId: episode.runId,
    suite: episode.suite,
    modelPolicy: episode.modelPolicy,
    passed: episode.outcome?.passed,
    score: episode.outcome?.score,
    costUsd: episode.outcome?.costUsd,
    failureCategory: episode.failure?.category,
    createdAt: episode.createdAt,
  };
}

function resolveRunDir(runArg) {
  if (runArg && existsSync(resolve(ROOT, runArg))) return resolve(ROOT, runArg);
  if (runArg && runArg !== "latest") {
    const direct = join(RUNS_DIR, runArg);
    if (existsSync(direct)) return direct;
  }
  const latest = join(RUNS_DIR, "latest");
  if (existsSync(latest)) return latest;
  if (!existsSync(RUNS_DIR)) return undefined;
  const dirs = readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(RUNS_DIR, entry.name);
      return { path, mtime: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return dirs[0]?.path;
}

function sqliteDoctor() {
  if (!existsSync(INDEX_PATH)) return { ok: false, reason: "missing index.db" };
  try {
    const db = openDb();
    const memoryCount = db.prepare("SELECT COUNT(*) AS count FROM memories").get().count;
    const ftsCount = db.prepare("SELECT COUNT(*) AS count FROM memories_fts").get().count;
    db.close();
    return { ok: true, memoryCount, ftsCount };
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

function parseSearchArgs(args) {
  const positional = [];
  let suite;
  let app;
  let limit = 8;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--suite") suite = args[++index];
    else if (arg.startsWith("--suite=")) suite = arg.slice("--suite=".length);
    else if (arg === "--app") app = args[++index];
    else if (arg.startsWith("--app=")) app = arg.slice("--app=".length);
    else if (arg === "--limit") limit = Number(args[++index] ?? limit);
    else if (arg.startsWith("--limit=")) limit = Number(arg.slice("--limit=".length));
    else positional.push(arg);
  }
  return { query: positional.join(" ").trim(), suite, app, limit: Number.isFinite(limit) ? limit : 8 };
}

function toFtsQuery(query) {
  const terms = query.toLowerCase().match(/[a-z0-9_:-]+/g) ?? [];
  return terms.length ? terms.map((term) => `"${term.replace(/"/g, "")}"`).join(" OR ") : `"${query.replace(/"/g, "")}"`;
}

function rankMemory(row, context) {
  let score = 100 - Number(row.fts_rank ?? 0);
  if (context.suite && row.suite === context.suite) score += 20;
  if (context.app && String(row.app).toLowerCase() === context.app.toLowerCase()) score += 10;
  const daysOld = Math.max(0, (context.now - Date.parse(row.created_at || 0)) / 86_400_000);
  score += Math.max(0, 15 - daysOld);
  if (row.failure_category && context.query.toLowerCase().includes(String(row.failure_category).toLowerCase())) score += 15;
  return score;
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

function upsertJsonl(path, item, key) {
  mkdirSync(dirname(path), { recursive: true });
  const rows = readJsonl(path).filter((row) => row?.[key] !== item[key]);
  rows.push(item);
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf-8");
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function appendRedactionLog(event) {
  mkdirSync(dirname(REDACTION_LOG), { recursive: true });
  const payload = { ts: new Date().toISOString(), ...event };
  writeFileSync(REDACTION_LOG, `${readMaybe(REDACTION_LOG)}${JSON.stringify(payload)}\n`, "utf-8");
}

function scrub(value) {
  const text = String(value ?? "");
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:sk|pk|ghp|gho|glpat|xox[baprs])-?[A-Za-z0-9_=-]{16,}\b/g, "[redacted-token]")
    .replace(/\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^"'\s,;]+/gi, "[redacted-secret]")
    .replace(/\bhttps?:\/\/(?:localhost|127\.0\.0\.1|[a-z0-9.-]*internal[a-z0-9.-]*|[a-z0-9.-]*corp[a-z0-9.-]*)[^\s"']*/gi, "[redacted-private-url]");
}

function normalizeFailureCategory(value) {
  if (!value) return undefined;
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return FAILURE_CATEGORIES.has(normalized) ? normalized : "proofloop_gap";
}

function firstExistingScreenshot(runDir) {
  const screenshotsDir = join(runDir, "screenshots");
  if (!existsSync(screenshotsDir)) return undefined;
  return readdirSync(screenshotsDir).find((name) => /\.(png|jpe?g)$/i.test(name)) ? `screenshots/${readdirSync(screenshotsDir).find((name) => /\.(png|jpe?g)$/i.test(name))}` : undefined;
}

function textFirstLine(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
}

function readMaybe(path) {
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function memoryId(runId, suite) {
  return `pmem_${createHash("sha256").update(`${repoId()}\n${suite}\n${runId}`).digest("hex").slice(0, 16)}`;
}

function repoId() {
  const result = spawnSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf-8" });
  return result.status === 0 ? result.stdout.trim() : basename(ROOT);
}

function rel(path) {
  return relative(ROOT, path).replace(/\\/g, "/");
}
