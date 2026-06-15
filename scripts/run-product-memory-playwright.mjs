import { spawn } from "node:child_process";
import { createServer } from "node:net";
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

const port = await choosePort();
const env = {
  ...process.env,
  PLAYWRIGHT_PORT: String(port),
  PLAYWRIGHT_BASE_URL: explicitPort && process.env.PLAYWRIGHT_BASE_URL ? process.env.PLAYWRIGHT_BASE_URL : `http://127.0.0.1:${port}`,
};
const playwrightCli = join("node_modules", "playwright", "cli.js");

console.log(`[product-memory] using ${env.PLAYWRIGHT_BASE_URL}`);

const child = spawn(process.execPath, [playwrightCli, "test", ...specs, "--workers=1"], {
  env,
  stdio: "inherit",
});

child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
