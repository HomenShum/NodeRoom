import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import http from "node:http";
import { join } from "node:path";

const specs = [
  "e2e/chat.spec.ts",
  "e2e/excel-grid.spec.ts",
  "e2e/semantic-rebase.spec.ts",
  "e2e/work-surface-split.spec.ts",
  "e2e/responsive-qa.spec.ts",
];

const explicitPort = process.env.PLAYWRIGHT_PORT;
const preferredPort = Number.parseInt(explicitPort ?? "5197", 10);
const reuseExternalServer = process.env.PLAYWRIGHT_REUSE_SERVER === "1";
if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) {
  throw new Error(`Invalid PLAYWRIGHT_PORT: ${explicitPort}`);
}

async function isPortFree(port) {
  return await new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function choosePort() {
  if (explicitPort) return preferredPort;
  for (let port = preferredPort; port < preferredPort + 50; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free Playwright product-test port found in ${preferredPort}-${preferredPort + 49}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestStatus(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(url), { method: "GET", timeout: 2_000 }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("timeout", () => req.destroy(new Error("request_timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function waitForHttp(url, timeoutMs, output) {
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
  if (output.value) process.stderr.write(output.value);
  throw new Error(`product_memory_server_not_ready:${url}:${lastError}`);
}

async function startDevServer(port, baseUrl) {
  const output = { value: "" };
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`]
    : ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  const server = spawn(command, commandArgs, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", (chunk) => { output.value += String(chunk); });
  server.stderr.on("data", (chunk) => { output.value += String(chunk); });
  server.on("exit", (code) => {
    if (code !== null && code !== 0 && output.value) process.stderr.write(output.value);
  });
  await waitForHttp(baseUrl, 120_000, output);
  return server;
}

function stopDevServer(server) {
  if (!server || server.killed) return;
  if (process.platform === "win32" && server.pid) {
    spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  server.kill();
}

const port = await choosePort();
const env = {
  ...process.env,
  PLAYWRIGHT_PORT: String(port),
  PLAYWRIGHT_BASE_URL: explicitPort && process.env.PLAYWRIGHT_BASE_URL ? process.env.PLAYWRIGHT_BASE_URL : `http://127.0.0.1:${port}`,
  PLAYWRIGHT_REUSE_SERVER: "1",
};
const playwrightCli = join("node_modules", "playwright", "cli.js");
let server;
let finishing = false;

console.log(`[product-memory] using ${env.PLAYWRIGHT_BASE_URL}`);

if (!reuseExternalServer) {
  server = await startDevServer(port, env.PLAYWRIGHT_BASE_URL);
} else {
  await waitForHttp(env.PLAYWRIGHT_BASE_URL, 30_000, { value: "" });
}

const child = spawn(process.execPath, [playwrightCli, "test", ...specs, "--workers=1"], {
  env,
  stdio: "inherit",
});

function finish(code) {
  if (finishing) return;
  finishing = true;
  stopDevServer(server);
  process.exit(code);
}

child.on("error", (err) => {
  console.error(err);
  finish(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    stopDevServer(server);
    process.kill(process.pid, signal);
    return;
  }
  finish(code ?? 1);
});

process.on("SIGINT", () => finish(130));
process.on("SIGTERM", () => finish(143));
