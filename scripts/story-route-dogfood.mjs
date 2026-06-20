import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { join } from "node:path";
import { chromium } from "playwright";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const [key, inlineValue] = arg.slice(2).split("=", 2);
  const value = inlineValue ?? (process.argv[i + 1]?.startsWith("--") ? undefined : process.argv[++i]);
  args.set(key, value ?? "1");
}

const baseUrlArg = args.get("base-url") || process.env.STORY_DOGFOOD_BASE_URL || "";
const localPort = Number(args.get("port") || process.env.STORY_DOGFOOD_PORT || 4190);
const localBaseUrl = `http://127.0.0.1:${localPort}`;
const baseUrl = baseUrlArg ? String(baseUrlArg).replace(/\/$/, "") : localBaseUrl;
const local = !baseUrlArg;
let server;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs) {
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
    await wait(400);
  }
  throw new Error(`story_route_not_ready:${url}:${lastError}`);
}

function requestStatus(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(parsed, { method: "GET", timeout: 2_000 }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("timeout", () => {
      req.destroy(new Error("request_timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

async function startPreviewServer() {
  if (!existsSync(join(process.cwd(), "dist", "index.html"))) {
    throw new Error("dist_missing: run npm run build before local story dogfood");
  }
  const command = process.platform === "win32" ? "cmd.exe" : "npx";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", `npx vite preview --host 127.0.0.1 --port ${localPort} --strictPort`]
    : ["vite", "preview", "--host", "127.0.0.1", "--port", String(localPort), "--strictPort"];
  server = spawn(command, commandArgs, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += String(chunk); });
  server.stderr.on("data", (chunk) => { output += String(chunk); });
  server.on("exit", (code) => {
    if (code !== null && code !== 0) process.stderr.write(output);
  });
  try {
    await waitForHttp(`${localBaseUrl}/#story`, 30_000);
  } catch (error) {
    if (output) process.stderr.write(output);
    throw error;
  }
}

function stopPreviewServer() {
  if (!server || server.killed) return;
  if (process.platform === "win32" && server.pid) {
    spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  server.kill();
}

async function assertStoryRoute() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${baseUrl}/#story`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.getByLabel("Q3 revenue cell C2").waitFor({ state: "visible", timeout: 15_000 });

    await page.getByLabel("Q3 revenue cell C2").fill("13,250");
    await page.getByLabel("Story agent prompt").fill("Recompute the revenue variance");
    await page.getByTestId("story-agent-send").click();

    const variance = await page.getByTestId("story-variance-cell").textContent();
    const finalVisible = await page.getByText(/kept the human C2 edit/i).isVisible();
    const computedVisible = await page.getByText("Computed D2 = C2 - B2 = 3,250.").isVisible();
    const demoVisible = await page.getByLabel("Interactive story demo").isVisible();
    if (variance !== "3,250" || !finalVisible || !computedVisible || !demoVisible) {
      throw new Error(`story_route_assertion_failed:${JSON.stringify({ demoVisible, variance, computedVisible, finalVisible })}`);
    }
    console.log(JSON.stringify({ ok: true, baseUrl, demoVisible, variance, computedVisible, finalVisible }));
  } finally {
    await browser.close();
  }
}

let exitCode = 0;
try {
  if (local) await startPreviewServer();
  else await waitForHttp(`${baseUrl}/#story`, 30_000);
  await assertStoryRoute();
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.stack || error.message : String(error));
} finally {
  stopPreviewServer();
  process.exit(exitCode);
}
