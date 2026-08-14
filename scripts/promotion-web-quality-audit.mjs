/**
 * Promotion loop — condition 8 producer: the web-quality audit.
 *
 * The human situation: someone opens NodeRoom on a phone, on a normal mobile
 * connection, and waits. Condition 8 asks whether that wait, and what a screen
 * reader is handed once it ends, are good enough that nothing major is left
 * unresolved. This script measures both with two off-the-shelf tools, so the
 * numbers do not depend on anyone's judgement — Lighthouse for speed, Core Web
 * Vitals and its own accessibility pass, axe-core for accessibility violations.
 *
 * Paper note: this script measures how long NodeRoom takes to become usable and
 * which accessibility rules it breaks, and fails if either is bad enough to
 * matter.
 *
 * Two things this script exists to stop, both of which happened while writing it:
 *
 * 1. **Auditing the loading skeleton instead of the app.** NodeRoom boots into a
 *    shimmer and hydrates seconds later. `@axe-core/cli` with no delay reported
 *    "0 violations found!" — a perfect score for a page with nothing on it. Every
 *    axe run here therefore waits (`--load-delay`, or an explicit testid wait) and
 *    the summary records which selector proved the app was actually up.
 * 2. **Auditing only what has a URL.** The room a stranger works in is reached by
 *    clicking, and the URL never changes, so no URL-taking CLI can see it. The
 *    room is audited through Playwright with the same axe rule set instead.
 *
 *   node scripts/promotion-web-quality-audit.mjs \
 *     --base-url http://127.0.0.1:4903 \
 *     --out promotion/evidence/iteration-2
 *
 * Requires a server already serving the production build on --base-url:
 *   npm run build && npx vite preview --host 127.0.0.1 --port 4903 --strictPort
 *
 * Exit 0 = no major unresolved finding. Exit 1 = at least one, listed in the
 * summary's `majors` array.
 */
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const baseUrl = arg("base-url", "http://127.0.0.1:4903").replace(/\/$/, "");
const outDir = resolve(arg("out", "promotion/evidence/iteration-2"));
/**
 * Two URLs, because NodeRoom ships two shells and grading the wrong one is a lie
 * in either direction. `surface=desktop` pins the three-pane layout; without it
 * the app picks the phone shell under a phone viewport. Lighthouse's mobile
 * preset therefore audits the URL a phone visitor actually opens, and the desktop
 * preset audits the pinned desktop surface. An earlier draft ran BOTH presets
 * against `surface=desktop`, which reported the desktop layout's cost as the
 * phone experience.
 */
const mobileUrl = `${baseUrl}/?mode=memory`;
const landingUrl = `${baseUrl}/?mode=memory&surface=desktop`;

/** Pinned so a re-run a year from now audits with the same rules, not newer ones. */
const LIGHTHOUSE = "lighthouse@13.4.1";
const AXE_CLI = "@axe-core/cli@4.13.0";
/** The rule set the baseline wave used, kept identical so the two are comparable. */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
/** Google's "poor" thresholds. Anything worse is a major finding, not a nit. */
const LCP_POOR_MS = 4000;
const CLS_POOR = 0.25;

// `shell: true` because on Windows npx is a .cmd, which Node refuses to spawn
// directly (EINVAL) since the CVE-2024-27980 fix. Shell means quoting is ours:
// the URL carries `&`, and the output path carries spaces on this machine.
const run = (args) =>
  execFileSync("npx", args.map((a) => (/[\s&?=]/.test(a) ? `"${a}"` : a)),
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 600_000, shell: true });

const majors = [];
const commands = [];

function lighthouse(label, preset, url) {
  const path = join(outDir, `lighthouse-${label}.json`);
  const args = ["--yes", LIGHTHOUSE, url, "--output=json", `--output-path=${path}`,
    '--chrome-flags=--headless', "--quiet", ...(preset ? [`--preset=${preset}`] : [])];
  commands.push(`npx ${args.join(" ")}`);
  run(args);
  const r = JSON.parse(readFileSync(path, "utf8"));
  const num = (id) => r.audits[id]?.numericValue ?? null;
  const out = {
    label,
    url,
    artifact: `lighthouse-${label}.json`,
    lighthouseVersion: r.lighthouseVersion,
    formFactor: r.configSettings.formFactor,
    throttling: r.configSettings.throttlingMethod,
    scores: Object.fromEntries(Object.entries(r.categories).map(([k, c]) => [k, c.score])),
    lcpMs: num("largest-contentful-paint"),
    cls: num("cumulative-layout-shift"),
    fcpMs: num("first-contentful-paint"),
    tbtMs: num("total-blocking-time"),
    ttiMs: num("interactive"),
    failingAudits: Object.entries(r.audits)
      .filter(([, a]) => a.score !== null && a.score < 1)
      .map(([id, a]) => ({ id, score: a.score, title: a.title })),
  };
  if (out.lcpMs > LCP_POOR_MS) {
    majors.push(`lighthouse/${label}: LCP ${Math.round(out.lcpMs)}ms exceeds the ${LCP_POOR_MS}ms "poor" threshold`);
  }
  if (out.cls > CLS_POOR) {
    majors.push(`lighthouse/${label}: CLS ${out.cls.toFixed(3)} exceeds the ${CLS_POOR} "poor" threshold`);
  }
  return out;
}

function axeCli() {
  const path = join(outDir, "axe-cli-landing.json");
  // 8s: the landing route's own boot rail finishes well inside this on the machines
  // measured. Without it axe grades the shimmer and reports a clean sheet.
  // `--save` is resolved against cwd even when absolute, so the directory goes in
  // `--dir` and the filename stays bare. Passing an absolute path to --save writes
  // to cwd + path and then fails with ENOENT.
  const args = ["--yes", AXE_CLI, landingUrl, "--load-delay", "8000",
    "--dir", outDir, "--save", "axe-cli-landing.json"];
  commands.push(`npx ${args.join(" ")}`);
  run(args);
  const [r] = JSON.parse(readFileSync(path, "utf8"));
  const violations = r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
  for (const v of violations) {
    if (v.impact === "critical" || v.impact === "serious") {
      majors.push(`axe-cli/landing: ${v.impact} ${v.id} on ${v.nodes} node(s) — ${v.help}`);
    }
  }
  return { artifact: "axe-cli-landing.json", url: r.url, testEngine: r.testEngine?.version,
    violations, passCount: r.passes.length, incompleteCount: r.incomplete.length };
}

/** The room has no URL, so it is reached the way a person reaches it: by clicking. */
async function axeRoom() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  const failedRequests = [];
  page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

  await page.goto(landingUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    try {
      localStorage.setItem("noderoom:tour:v1", "done");
      localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: true, paused: false }));
    } catch { /* first-visit storage may be blocked; the room still opens */ }
  });
  const enter = page.getByTestId("start-demo-room");
  await enter.waitFor({ state: "visible", timeout: 60_000 });
  await enter.click();
  // The wait that proves the app, not the skeleton, is what axe sees.
  await page.getByTestId("artifact-panel").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(2_000);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  await page.screenshot({ path: join(outDir, "room-1440-audited.png") });
  writeFileSync(join(outDir, "axe-room.json"), `${JSON.stringify(results, null, 2)}\n`);
  await browser.close();

  const violations = results.violations.map((v) => ({
    id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help,
    targets: v.nodes.slice(0, 6).map((n) => n.target.join(" ")),
  }));
  for (const v of violations) {
    if (v.impact === "critical" || v.impact === "serious") {
      majors.push(`axe-room: ${v.impact} ${v.id} on ${v.nodes} node(s) — ${v.help}`);
    }
  }
  return { artifact: "axe-room.json", screenshot: "room-1440-audited.png",
    provedAppUpBy: '[data-testid="artifact-panel"] visible', tags: AXE_TAGS,
    axeVersion: results.testEngine?.version, violations,
    passCount: results.passes.length, incompleteCount: results.incomplete.length,
    consoleErrors, failedRequests };
}

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const summary = {
    condition: 8,
    baseUrl,
    mobileUrl,
    landingUrl,
    capturedAt: new Date().toISOString(),
    node: process.version,
    lighthouseMobile: lighthouse("landing-mobile", null, mobileUrl),
    lighthouseDesktop: lighthouse("landing-desktop", "desktop", landingUrl),
    axeCliLanding: axeCli(),
    axeRoom: await axeRoom(),
  };
  summary.commands = commands;
  summary.majors = majors;
  summary.pass = majors.length === 0;
  writeFileSync(join(outDir, "web-quality-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ pass: summary.pass, majors }, null, 2));
  process.exit(summary.pass ? 0 : 1);
};

main().catch((err) => { console.error(err); process.exit(1); });
