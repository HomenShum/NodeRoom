/**
 * Worker HTTP API (routes documented in ../api.ts). Loopback only; browser
 * requests must come from a localhost origin or NODE_AGENT_ALLOWED_ORIGINS.
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { FileContent, FileEntry, HealthResponse, ToolEntry } from "../api.js";
import type { NodeAgentEvent, ProviderEnv } from "../contract.js";
import { classify, snapshot } from "../artifacts.js";
import type { EngineRegistry } from "../registry.js";
import { listSkills } from "../skills/catalog.js";
import { buildNodeToolCatalog } from "../tools/catalog.js";
import { isRestricted, resolveInside, toRel } from "../tools/workspaceFs.js";
import { HttpError, type RunManager } from "./runManager.js";
import type { TemplateEntry } from "./templates.js";

export const MAX_JSON_BODY = 1024 * 1024;
export const MAX_FILE_READ = 512 * 1024;
export const MAX_SSE_CLIENTS = 64;
export const HEARTBEAT_MS = 15_000;
/** A client that stops reading is dropped (it reconnects with Last-Event-ID). */
const MAX_SSE_BUFFERED = 8 * 1024 * 1024;

export interface HttpOptions {
  manager: RunManager;
  registry: EngineRegistry;
  templates: Map<string, TemplateEntry>;
  env: ProviderEnv;
  worker: HealthResponse["worker"];
  allowedOrigins?: string[];
  heartbeatMs?: number;
  log?: (m: string) => void;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostAllowed(hostname: string, allowedHosts: Set<string>): boolean {
  const h = hostname.toLowerCase();
  return LOOPBACK.has(h) || h.endsWith(".localhost") || allowedHosts.has(h);
}

function originAllowed(origin: string, allowed: Set<string>): boolean {
  if (allowed.has(origin)) return true;
  try {
    return LOOPBACK.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(json) });
  res.end(json);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > MAX_JSON_BODY) {
      reject(new HttpError(413, `JSON body exceeds ${MAX_JSON_BODY} bytes`));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (c: Buffer) => {
      if (failed) return;
      size += c.length;
      if (size > MAX_JSON_BODY) {
        failed = true;
        reject(new HttpError(413, `JSON body exceeds ${MAX_JSON_BODY} bytes`));
        return;
      }
      chunks.push(c);
    });
    req.on("error", (err) => !failed && reject(err));
    req.on("end", () => {
      if (failed) return;
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, "Body is not valid JSON"));
      }
    });
  });
}

function intParam(v: string | null | undefined, fallback: number): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `Expected a non-negative integer, got "${v}"`);
  return n;
}

function readBounded(abs: string, max: number): { bytes: number; text: string; truncated: boolean } {
  const bytes = statSync(abs).size;
  const len = Math.min(bytes, max);
  const buf = Buffer.alloc(len);
  const fd = openSync(abs, "r");
  try {
    readSync(fd, buf, 0, len, 0);
  } finally {
    closeSync(fd);
  }
  return { bytes, text: buf.toString("utf8"), truncated: bytes > max };
}

export function createHttpServer(opts: HttpOptions): http.Server {
  const { manager } = opts;
  const log = opts.log ?? (() => {});
  const allowed = new Set((opts.allowedOrigins ?? []).map((o) => o.trim()).filter(Boolean));
  const allowedHosts = new Set<string>();
  for (const o of allowed) {
    try {
      allowedHosts.add(new URL(o).hostname.toLowerCase());
    } catch {
      // not a URL; only exact Origin matches apply
    }
  }
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const sseClients = new Set<ServerResponse>();

  function sse(req: IncomingMessage, res: ServerResponse, runId: string, url: URL): void {
    manager.getRun(runId);
    if (sseClients.size >= MAX_SSE_CLIENTS) throw new HttpError(503, `At most ${MAX_SSE_CLIENTS} live event streams; close one and retry`);
    const header = req.headers["last-event-id"];
    let last = intParam(typeof header === "string" && header ? header : url.searchParams.get("after"), 0);
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write(": connected\n\n");
    sseClients.add(res);
    const write = (e: NodeAgentEvent) => {
      if (e.seq <= last || res.destroyed) return;
      last = e.seq;
      res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
      if (res.writableLength > MAX_SSE_BUFFERED) res.destroy();
    };
    // Replay and subscribe run in the same synchronous turn (store reads are sync), so no event falls between them.
    for (;;) {
      const page = manager.store.events(runId, last, 1000);
      if (page.length === 0 || res.destroyed) break;
      for (const e of page) write(e);
    }
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = manager.subscribe(runId, write);
    } catch (err) {
      sseClients.delete(res);
      res.end(`: ${err instanceof Error ? err.message : String(err)}\n\n`);
      return;
    }
    const beat = setInterval(() => res.write(": heartbeat\n\n"), heartbeatMs);
    const cleanup = () => {
      clearInterval(beat);
      unsubscribe?.();
      sseClients.delete(res);
    };
    res.on("close", cleanup);
    res.on("error", cleanup);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";
    const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== "api") throw new HttpError(404, `No route ${method} ${url.pathname}`);
    const [, a, id, sub, ...rest] = parts;
    if (rest.length) throw new HttpError(404, `No route ${method} ${url.pathname}`);
    const is = (m: string, resource: string, withId: boolean, subPath?: string) =>
      method === m && a === resource && (withId ? id !== undefined : id === undefined) && sub === subPath;

    if (is("GET", "health", false)) {
      const body: HealthResponse = {
        ok: true,
        worker: opts.worker,
        engines: await opts.registry.health(opts.env),
        templates: [...opts.templates.values()].map((t) => ({ id: t.config.id, title: t.config.title, description: t.config.description, suggestedTasks: t.config.suggestedTasks ?? [] })),
      };
      return send(res, 200, body);
    }
    if (is("GET", "projects", false)) return send(res, 200, manager.listProjects());
    if (is("POST", "projects", false)) return send(res, 201, manager.createProject((await readJson(req)) as never));
    if (is("GET", "projects", true, "files")) {
      const p = manager.project(id);
      const restricted = manager.template(p).config.restrictedGlobs;
      const snap = snapshot(p.workspaceDir);
      const files: FileEntry[] = [];
      for (const [rel, f] of snap.files) {
        if (isRestricted(rel, restricted)) continue;
        files.push({ path: rel, bytes: f.bytes, sha256: f.sha256, kind: classify(rel, p.workspaceDir), modifiedAt: new Date(f.mtimeMs).toISOString() });
      }
      return send(res, 200, files.sort((x, y) => (x.path < y.path ? -1 : 1)));
    }
    if (is("GET", "projects", true, "file")) {
      const p = manager.project(id);
      const rel = url.searchParams.get("path");
      if (!rel) throw new HttpError(400, "path query parameter is required");
      const abs = resolveInside(p.workspaceDir, rel);
      if (!abs) throw new HttpError(403, `Path "${rel}" is outside the project workspace`);
      const relNorm = toRel(p.workspaceDir, abs);
      if (isRestricted(relNorm, manager.template(p).config.restrictedGlobs)) throw new HttpError(403, `Path "${relNorm}" is restricted by the project template`);
      let st;
      try {
        st = statSync(abs);
      } catch {
        throw new HttpError(404, `No file "${relNorm}"`);
      }
      if (!st.isFile()) throw new HttpError(400, `"${relNorm}" is not a file`);
      const r = readBounded(abs, MAX_FILE_READ);
      const body: FileContent = { path: relNorm, ...r };
      return send(res, 200, body);
    }
    if (is("GET", "projects", true, "skills")) {
      const p = manager.project(id);
      return send(res, 200, listSkills(p.workspaceDir, p.nodeStateDir));
    }
    if (is("GET", "tools", false)) {
      const tools: ToolEntry[] = buildNodeToolCatalog({ nativeFileTools: false }).map((t) => ({
        name: t.name,
        family: t.family,
        risk: t.risk,
        description: t.description,
        alwaysLoad: t.alwaysLoad === true,
      }));
      return send(res, 200, tools);
    }
    if (is("GET", "runs", false)) return send(res, 200, manager.listRuns(url.searchParams.get("projectId") ?? undefined));
    if (is("POST", "runs", false)) return send(res, 201, await manager.createRun((await readJson(req)) as never));
    if (is("GET", "runs", true)) return send(res, 200, manager.getRun(id));
    if (is("GET", "runs", true, "events")) return sse(req, res, id, url);
    if (is("GET", "runs", true, "events.json")) {
      const after = intParam(url.searchParams.get("after"), 0);
      const limit = intParam(url.searchParams.get("limit"), 500);
      return send(res, 200, manager.events(id, after, limit || 500));
    }
    if (is("POST", "runs", true, "interrupt")) {
      await readJson(req);
      return send(res, 200, await manager.interrupt(id));
    }
    if (is("POST", "runs", true, "resume")) return send(res, 201, await manager.resume(id, (await readJson(req)) as never));
    if (is("POST", "runs", true, "message")) {
      const body = (await readJson(req)) as { text?: unknown };
      const out = await manager.message(id, body?.text);
      return send(res, out.accepted ? 200 : 409, out.accepted ? out : { ...out, error: out.reason });
    }
    if (is("POST", "runs", true, "handoff")) return send(res, 201, await manager.handoff(id, (await readJson(req)) as never));
    if (is("POST", "runs", true, "verify")) {
      await readJson(req);
      return send(res, 200, await manager.verify(id));
    }
    throw new HttpError(404, `No route ${method} ${url.pathname}`);
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    const hostname = (() => {
      try {
        return new URL(`http://${req.headers.host ?? ""}`).hostname;
      } catch {
        return "";
      }
    })();
    if (!hostAllowed(hostname, allowedHosts)) return send(res, 403, { error: `Host "${req.headers.host ?? ""}" is not allowed` });
    if (origin !== undefined) {
      if (!originAllowed(origin, allowed)) return send(res, 403, { error: `Origin "${origin}" is not allowed` });
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, last-event-id",
          "access-control-max-age": "600",
        });
        return void res.end();
      }
    }
    route(req, res).catch((err: unknown) => {
      const status = err instanceof HttpError ? err.status : err instanceof URIError ? 400 : 500;
      const message = err instanceof Error ? err.message : String(err);
      if (status >= 500) log(`${req.method} ${req.url} -> ${status}: ${message}`);
      send(res, status, { error: message });
    });
  });
  return server;
}
