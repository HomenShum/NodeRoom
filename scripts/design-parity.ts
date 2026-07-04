/**
 * design:parity — paired design-specimen vs product screenshots.
 *
 * Serves the gitignored `design-reference/` bundle on a free port with a plain
 * node http server (no deps), starts `vite preview` over the existing `dist/`
 * build (this script builds NOTHING), then screenshots each [specimen, product]
 * pair at desktop + phone viewports into .proofloop/parity-screenshots/.
 *
 * Preconditions (see --help):
 *   1. `npm run build` has produced dist/ (we refuse to build for you).
 *   2. `design-reference/` exists locally (re-export from Claude Design if not).
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { createServer as createNetServer } from "node:net";
import { extname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = process.cwd();
const DESIGN_ROOT = join(ROOT, "design-reference");
const DIST_INDEX = join(ROOT, "dist", "index.html");
const OUT_DIR = join(ROOT, ".proofloop", "parity-screenshots");

type ParityPair = {
  /** Slug used in the saved file names. */
  id: string;
  /** Path (URL-encoded) of the specimen shell inside design-reference/. */
  specimenPath: string;
  /** Product route (query string included) on the vite preview server. */
  productPath: string;
  description: string;
};

/** Add more specimen/product pairs here as the design bundle grows. */
const PARITY_PAIRS: ParityPair[] = [
  {
    id: "states-scale",
    specimenPath: "/NodeRoom%20States%20%26%20Scale.html",
    productPath: "/?mode=memory&demo=scale&name=Host",
    description: "States & Scale specimen vs the live scale demo room",
  },
];

const VIEWPORTS = [
  { width: 1512, height: 812 },
  { width: 375, height: 812 },
];

const HELP = [
  "design:parity - paired design-vs-product screenshots",
  "",
  "Usage: npm run design:parity [-- --help]",
  "",
  "Preconditions:",
  "  - dist/ must exist: this command never builds. Run `npm run build` first.",
  "  - product screenshots reflect the CURRENT dist/ build - rebuild after UI changes or the product side is stale.",
  "  - design-reference/ must exist locally (gitignored Claude Design export).",
  "",
  "What it does:",
  "  1. serves design-reference/ on a free port (plain node http, no deps)",
  "  2. starts `vite preview` over dist/ on a free port",
  `  3. screenshots each pair at ${VIEWPORTS.map((v) => `${v.width}x${v.height}`).join(" and ")}`,
  "  4. writes design-<id>-<WxH>.png / product-<id>-<WxH>.png to .proofloop/parity-screenshots/",
  "",
  "Pairs:",
  ...PARITY_PAIRS.map((pair) => `  - ${pair.id}: ${pair.description}`),
].join("\n");

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP);
    return;
  }
  if (!existsSync(DESIGN_ROOT)) {
    console.error("design:parity: design-reference/ is missing (it is gitignored).");
    console.error("Re-export the Claude Design bundle into design-reference/ and rerun.");
    process.exitCode = 1;
    return;
  }
  if (!existsSync(DIST_INDEX)) {
    console.error("design:parity: dist/ is missing - this command builds nothing.");
    console.error("Run exactly:");
    console.error("  npm run build");
    console.error("  npm run design:parity");
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const design = await startStaticServer(DESIGN_ROOT);
  const preview = await startVitePreview();
  const browser = await chromium.launch();
  const saved: string[] = [];
  try {
    for (const pair of PARITY_PAIRS) {
      for (const viewport of VIEWPORTS) {
        const size = `${viewport.width}x${viewport.height}`;
        saved.push(
          await capture(browser, viewport, `${design.baseUrl}${pair.specimenPath}`, join(OUT_DIR, `design-${pair.id}-${size}.png`))
        );
        saved.push(
          await capture(browser, viewport, `${preview.baseUrl}${pair.productPath}`, join(OUT_DIR, `product-${pair.id}-${size}.png`))
        );
      }
    }
  } finally {
    await browser.close();
    design.stop();
    preview.stop();
  }
  console.log(`design:parity: saved ${saved.length} screenshots`);
  for (const file of saved) console.log(`  ${file}`);
}

async function capture(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  viewport: { width: number; height: number },
  url: string,
  outPath: string
): Promise<string> {
  const page = await browser.newPage({ viewport });
  try {
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    // Specimens compile via CDN Babel and the product seeds demo data; give both a settle window.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: outPath });
  } finally {
    await page.close();
  }
  return outPath;
}

/** Static file server for design-reference/ — decodes %20/%26 paths, blocks traversal. */
function startStaticServer(root: string): Promise<{ baseUrl: string; stop: () => void }> {
  const server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      const relPath = pathname.replace(/^\/+/, "") || "index.html";
      const filePath = resolve(root, relPath);
      if (!filePath.startsWith(resolve(root))) {
        res.writeHead(403).end("forbidden");
        return;
      }
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": contentTypeFor(filePath) });
      res.end(readFileSync(filePath));
    } catch {
      res.writeHead(500).end("error");
    }
  });
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectPromise(new Error("design_reference_server_no_port"));
        return;
      }
      resolvePromise({ baseUrl: `http://127.0.0.1:${address.port}`, stop: () => server.close() });
    });
  });
}

function contentTypeFor(filePath: string): string {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".woff2": "font/woff2",
  };
  return types[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/** Same spawn idiom as scripts/design-quality.ts — cmd.exe shim on Windows, taskkill teardown. */
async function startVitePreview(): Promise<{ baseUrl: string; stop: () => void }> {
  const port = await chooseFreePort(Number.parseInt(process.env.DESIGN_PARITY_PORT ?? "5361", 10));
  const baseUrl = `http://127.0.0.1:${port}`;
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`]
    : ["exec", "vite", "preview", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  const child = spawn(command, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }) as ChildProcessWithoutNullStreams;
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  await waitForHttp(baseUrl, 60_000, () => output);
  return { baseUrl, stop: () => stopChild(child) };
}

async function chooseFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 40; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free design-parity port in ${start}-${start + 39}`);
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const probe = createNetServer();
    probe.once("error", () => resolvePromise(false));
    probe.once("listening", () => probe.close(() => resolvePromise(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function waitForHttp(url: string, timeoutMs: number, output: () => string) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const status = await requestStatus(url);
      if (status >= 200 && status < 500) return;
      lastError = `HTTP ${status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
  }
  throw new Error(`design_parity_server_not_ready:${url}:${lastError}\n${output()}`);
}

function requestStatus(url: string): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = http.request(new URL(url), { method: "GET", timeout: 2_000 }, (res) => {
      res.resume();
      res.on("end", () => resolvePromise(res.statusCode ?? 0));
    });
    req.on("timeout", () => req.destroy(new Error("request_timeout")));
    req.on("error", rejectPromise);
    req.end();
  });
}

function stopChild(child: ChildProcessWithoutNullStreams) {
  if (child.killed) return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return;
  }
  child.kill();
}

main().catch((error) => {
  console.error(`design:parity failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
