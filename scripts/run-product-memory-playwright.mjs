import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import http from "node:http";
import { join } from "node:path";

const suiteArg = process.argv.find((arg) => arg.startsWith("--suite="))?.slice("--suite=".length) ?? "product-memory";
if (suiteArg !== "product-memory" && suiteArg !== "launch-surface") {
  throw new Error(`Invalid Playwright product suite: ${suiteArg}`);
}
const launchSurface = suiteArg === "launch-surface";
const suiteLabel = launchSurface ? "launch-surface" : "product-memory";
const errorPrefix = suiteLabel.replaceAll("-", "_");
const specs = launchSurface
  ? [
      "e2e/first-run-launch.spec.ts",
      "e2e/mobile-terracotta-contract.spec.ts",
    ]
  : [
      "e2e/chat.spec.ts",
      "e2e/excel-grid.spec.ts",
      "e2e/privacy-job-wall-proposal.spec.ts",
      "e2e/semantic-rebase.spec.ts",
      "e2e/work-surface-split.spec.ts",
      "e2e/responsive-qa.spec.ts",
      "e2e/full-modern-ux-bar.spec.ts",
    ];

// Launch-surface proof exercises routing and consent without touching a live backend.
// The separate deployed-auth proof owns authenticated mutations and revision checks.
const commandEnv = launchSurface
  ? {
      ...process.env,
      VITE_CONVEX_URL: "https://launch-surface-proof.convex.cloud",
      VITE_NODEROOM_AUTH_REQUIRED: "0",
    }
  : process.env;

const explicitPort = process.env.PLAYWRIGHT_PORT;
const preferredPort = Number.parseInt(explicitPort ?? "5197", 10);
const reuseExternalServer = !launchSurface && process.env.PLAYWRIGHT_REUSE_SERVER === "1";
const skipBuild = process.env.PRODUCT_MEMORY_SKIP_BUILD === "1";
const serverMode = process.env.PRODUCT_MEMORY_SERVER ?? "preview";
if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) {
  throw new Error(`Invalid PLAYWRIGHT_PORT: ${explicitPort}`);
}
if (serverMode !== "preview" && serverMode !== "dev") {
  throw new Error(`Invalid PRODUCT_MEMORY_SERVER: ${serverMode}`);
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

async function waitForHttp(url, timeoutMs, output, owner) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (owner && (owner.exitCode !== null || owner.signalCode !== null)) {
      if (output.value) process.stderr.write(output.value);
      throw new Error(`${errorPrefix}_server_exited:${owner.exitCode ?? owner.signalCode}`);
    }
    try {
      const status = await requestStatus(url);
      if (status >= 200 && status < 500) {
        if (owner) {
          await wait(100);
          if (owner.exitCode !== null || owner.signalCode !== null) continue;
        }
        return;
      }
      lastError = `HTTP ${status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await wait(400);
  }
  if (output.value) process.stderr.write(output.value);
  throw new Error(`${errorPrefix}_server_not_ready:${url}:${lastError}`);
}

function runChecked(command, args, label) {
  console.log(`[${suiteLabel}] ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    env: commandEnv,
  });
  if (result.status !== 0) {
    throw new Error(`${errorPrefix}_${label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_failed:${result.status ?? result.signal}`);
  }
}

function buildServerCommand(port) {
  if (serverMode === "dev") {
    return process.platform === "win32"
      ? {
          command: "cmd.exe",
          args: ["/d", "/s", "/c", `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`],
        }
      : {
          command: "npm",
          args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
        };
  }
  return {
    command: process.execPath,
    args: [join("node_modules", "vite", "bin", "vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  };
}

async function startProductServer(port, baseUrl) {
  const output = { value: "" };
  const { command, args } = buildServerCommand(port);
  const server = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: commandEnv,
  });
  server.stdout.on("data", (chunk) => { output.value += String(chunk); });
  server.stderr.on("data", (chunk) => { output.value += String(chunk); });
  server.on("exit", (code) => {
    if (code !== null && code !== 0 && output.value) process.stderr.write(output.value);
  });
  try {
    await waitForHttp(baseUrl, 120_000, output, server);
    return server;
  } catch (error) {
    stopDevServer(server);
    throw error;
  }
}

function stopDevServer(server) {
  if (!server || server.killed) return;
  if (process.platform === "win32" && server.pid) {
    spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  server.kill();
}

const playwrightCli = join("node_modules", "playwright", "cli.js");
let server;
let finishing = false;

console.log(`[${suiteLabel}] server=${reuseExternalServer ? "external" : serverMode}${skipBuild ? " skip-build" : ""}`);

if (!reuseExternalServer && serverMode === "preview" && !skipBuild) {
  runChecked(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"], "building production bundle");
}

let port = await choosePort();
let baseUrl = explicitPort && process.env.PLAYWRIGHT_BASE_URL
  ? process.env.PLAYWRIGHT_BASE_URL
  : `http://127.0.0.1:${port}`;

if (!reuseExternalServer) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    console.log(`[${suiteLabel}] using ${baseUrl}`);
    try {
      server = await startProductServer(port, baseUrl);
      break;
    } catch (error) {
      const portWasClaimed = !explicitPort && !(await isPortFree(port));
      if (!portWasClaimed || attempt === 5) throw error;
      console.warn(`[${suiteLabel}] port ${port} was claimed during startup; selecting another port`);
      port = await choosePort();
      baseUrl = `http://127.0.0.1:${port}`;
    }
  }
} else {
  console.log(`[${suiteLabel}] using ${baseUrl}`);
  await waitForHttp(baseUrl, 30_000, { value: "" });
}

const env = {
  ...commandEnv,
  PLAYWRIGHT_PORT: String(port),
  PLAYWRIGHT_BASE_URL: baseUrl,
  PLAYWRIGHT_REUSE_SERVER: "1",
};

const child = spawn(process.execPath, [playwrightCli, "test", ...specs, "--workers=1", "--timeout=60000"], {
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
