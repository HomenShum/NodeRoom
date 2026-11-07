// No-cost smoke of the quickstart app served from the committed tarball, against a worker with an EMPTY home:
// worker health through the app's proxy, UI render, one project created from the template, settled empty-run state.
// Every reported value is read from the worker, the DOM or the network log, not hardcoded.
// Usage (repo root, NODE_PATH=node_modules): node tarball-smoke.cjs <out.png> <out.json>
const fs = require("fs");
const crypto = require("crypto");
const { chromium } = require("playwright");
const [out, report] = process.argv.slice(2);
const base = "http://localhost:5280";
const api = `${base}/agent-api/api`;

(async () => {
  const health = await (await fetch(`${api}/health`)).json();
  const projectsBefore = await (await fetch(`${api}/projects`)).json();
  if (projectsBefore.length !== 0) throw new Error(`worker home is not empty: ${projectsBefore.length} project(s)`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const posts = [];
  page.on("request", (r) => { if (r.method() === "POST") posts.push(new URL(r.url()).pathname); });
  await page.goto(base);
  await page.getByText("Worker v").waitFor();
  await page.locator("select").first().selectOption("diligence-pack");
  await page.getByRole("button", { name: "New project" }).click();
  // The button reads "Creating…" until the worker answers; wait for it to come back, then for the empty-run brief.
  await page.getByRole("button", { name: "New project" }).waitFor({ timeout: 30_000 });
  const brief = page.locator(".naw-brief-empty p");
  await brief.filter({ hasText: "No runs yet" }).waitFor({ timeout: 30_000 });
  const projectsAfter = await (await fetch(`${api}/projects`)).json();
  const runsAfter = await (await fetch(`${api}/runs?projectId=${encodeURIComponent(projectsAfter[0]?.id ?? "")}`)).json();
  const ui = {
    brief: (await brief.innerText()).trim(),
    creatingVisible: await page.getByText(/Creating/).count(),
    loadingRunsVisible: await page.getByText("Loading runs…").count(),
    setupNotice: (await page.getByText("Setup required for").first().locator("..").innerText()).split("\n").filter(Boolean),
    engineRail: (await page.locator(".naw-rail-section").filter({ hasText: "Engines" }).innerText()).split("\n").filter(Boolean),
  };
  await page.screenshot({ path: out });
  await browser.close();

  const app = "examples/nodeagent-workspace-quickstart";
  const tgz = fs.readFileSync(`${app}/vendor/homenshum-nodeagent-engines-0.1.0.tgz`);
  const installed = JSON.parse(fs.readFileSync(`${app}/node_modules/.package-lock.json`, "utf8"))
    .packages["node_modules/@homenshum/nodeagent-engines"].integrity;
  fs.writeFileSync(report, JSON.stringify({
    capturedAt: new Date().toISOString(),
    tarballSha256: crypto.createHash("sha256").update(tgz).digest("hex"),
    installedPackageMatchesTarball: installed === "sha512-" + crypto.createHash("sha512").update(tgz).digest("base64"),
    templates: (health.templates || []).map((t) => t.id),
    projectsBefore: projectsBefore.length,
    projectsAfter: projectsAfter.map((p) => p.template ?? p.templateId ?? p.name),
    runsInProject: runsAfter.length,
    browserPostRequests: posts,
    ui,
  }, null, 2));
  console.log("ok", out);
})().catch((e) => { console.error(e); process.exit(1); });
