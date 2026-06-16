/**
 * Design-QA deterministic floor (S0 + S1 + S2 + S5 of docs/design/DESIGN_QA_LADDER.md).
 *
 * Computes objective PASS/FAIL for a class of "polish" so the VLM never has to opine on it:
 *   S0  parse design tokens from styles.css :root (spacing scale + color tokens)
 *   S1  capture each surface (reduced-motion, pinned viewport/DPR, blank-render hard-fail)
 *   S2  deterministic checks -> findings (overflow, contrast, reduced-motion, tabular-nums, token drift)
 *   S5  NN/G 0-4 severity -> P-level triage + SHIP bar (ship iff zero P0/P1)
 *
 * Run from the REAL node_modules (the worktree junction breaks tsx ESM resolution):
 *   QA_BASE_URL=http://localhost:5301 npx tsx <worktree>/scripts/design-qa/floor.ts
 * Exit code 0 = ship bar met (no P0/P1); 1 = blocked. Report -> .tmp-qa/design-floor.json
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WT_ROOT = join(HERE, "..", ".."); // worktree root (scripts/design-qa -> up two)
const BASE = process.env.QA_BASE_URL ?? "http://localhost:5301";
const OUT = join(process.cwd(), ".tmp-qa");
mkdirSync(join(OUT, "design-floor"), { recursive: true });

type Sev = "P0" | "P1" | "P2";
type Finding = { surface: string; sev: Sev; check: string; detail: string };

// ---- S0: token snapshot ---------------------------------------------------
function parseTokens() {
  const css = readFileSync(join(WT_ROOT, "src", "app", "styles.css"), "utf8");
  const root = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const spacing = new Set<number>([0]);
  for (const m of root.matchAll(/--space-\d+:\s*(\d+)px/g)) spacing.add(Number(m[1]));
  const colors = new Set<string>();
  for (const m of root.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) colors.add(("#" + m[1]).toLowerCase());
  // dark theme block too
  const dark = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  for (const m of dark.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) colors.add(("#" + m[1]).toLowerCase());
  return { spacing: [...spacing], colors: [...colors] };
}

// ---- S1: surface registry -------------------------------------------------
type Surface = { name: string; width: number; height: number; ready: string; open: (p: Page) => Promise<void> };
const SURFACES: Surface[] = [
  {
    name: "demo-room-desktop", width: 1440, height: 900, ready: "[data-testid='shell-bottom']",
    open: async (p) => { await p.goto(`${BASE}/?demo=QA${Date.now() % 99999}&name=Founder`, { waitUntil: "domcontentloaded" }); },
  },
  {
    name: "demo-room-mobile", width: 375, height: 812, ready: "[data-testid='shell-bottom']",
    open: async (p) => { await p.goto(`${BASE}/?demo=QM${Date.now() % 99999}&name=Founder`, { waitUntil: "domcontentloaded" }); },
  },
  {
    name: "blank-room", width: 1280, height: 860, ready: "[data-testid='blank-room-state'], [data-testid='shell-bottom']",
    open: async (p) => {
      await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(700);
      await p.fill("input[placeholder='e.g. Priya']", "QA").catch(() => {});
      await p.click("[data-testid='create-room']").catch(() => {});
    },
  },
];

// ---- S2: deterministic checks (run in-page) -------------------------------
// returns raw signals; severity is assigned host-side (S5) so the VLM is never involved.
function pageChecks(spacingScale: number[], tokenColors: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (args: { spacingScale: number[]; tokenColors: string[] }) => {
    const SCALE = new Set(args.spacingScale);
    const TOKENS = new Set(args.tokenColors);
    const toHex = (c: string): string | null => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a] = m[1].split(",").map((x) => parseFloat(x.trim()));
      if (a !== undefined && a < 0.95) return null; // transparent-ish: ignore for token drift
      const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
      return ("#" + h(r) + h(g) + h(b)).toLowerCase();
    };
    const lum = (c: string): number | null => {
      const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null;
      const [r, g, b] = m[1].split(",").map((x) => parseFloat(x.trim()) / 255);
      const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const effBg = (el: Element): string => {
      let n: Element | null = el;
      while (n) {
        const bg = getComputedStyle(n).backgroundColor;
        const m = bg.match(/rgba?\(([^)]+)\)/);
        const a = m ? parseFloat((m[1].split(",")[3] ?? "1").trim()) : 0;
        if (m && a >= 0.95) return bg;
        n = n.parentElement;
      }
      return "rgb(17,20,24)"; // app bg fallback (dark)
    };
    const contrastFails: { sel: string; ratio: number; size: number }[] = [];
    const offTokenColors = new Set<string>();
    let scanned = 0;
    const sel = "button, a, .r-tab, .fn, .fm, .r-trace-item .tt, .r-status, td, th, .r-btn, h1, h2, h3, p, span";
    for (const el of Array.from(document.querySelectorAll(sel)).slice(0, 600)) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (el.closest(".r-av, .r-avatar, .r-mark, .r-co-av, .r-srcchip-dot")) continue; // decorative identity/brand marks: AA text-contrast n/a
      const cs = getComputedStyle(el);
      if (!(el.textContent ?? "").trim()) {
        // non-text: still collect bg for token drift
        const bgHex = toHex(cs.backgroundColor); if (bgHex && !TOKENS.has(bgHex)) offTokenColors.add(bgHex);
        continue;
      }
      scanned++;
      const fg = cs.color, bg = effBg(el);
      const l1 = lum(fg), l2 = lum(bg);
      if (l1 != null && l2 != null) {
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const size = parseFloat(cs.fontSize);
        const bold = parseInt(cs.fontWeight) >= 700;
        const large = size >= 24 || (size >= 18.66 && bold);
        const min = large ? 3 : 4.5;
        if (ratio < min - 0.05) contrastFails.push({ sel: (el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "")), ratio: Math.round(ratio * 100) / 100, size });
      }
      const fgHex = toHex(fg); if (fgHex && !TOKENS.has(fgHex)) offTokenColors.add(fgHex);
    }
    // overflow
    const de = document.documentElement;
    const overflow = de.scrollWidth - de.clientWidth;
    // reduced-motion respected? (a panel should have ~0 animation-duration under reduce)
    const panel = document.querySelector(".r-panel");
    const animDur = panel ? getComputedStyle(panel).animationDuration : "n/a";
    // tabular-nums on finance table
    const td = document.querySelector(".r-research td");
    const tnum = td ? getComputedStyle(td).fontVariantNumeric : "n/a";
    return {
      scanned,
      overflowPx: overflow,
      contrastFails: contrastFails.slice(0, 12),
      contrastFailCount: contrastFails.length,
      offTokenColors: [...offTokenColors].slice(0, 14),
      offTokenCount: offTokenColors.size,
      reducedMotionDur: animDur,
      financeTabularNums: tnum,
      hasResearchTable: !!td,
    };
  };
}

// ---- orchestrate ----------------------------------------------------------
const tokens = parseTokens();
const findings: Finding[] = [];
const browser = await chromium.launch();
for (const s of SURFACES) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  // tsx/esbuild keep-names injects __name into evaluated closures; shim it in the page (string form
  // so esbuild does not transpile this line) before any navigation.
  await page.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
  await page.emulateMedia({ reducedMotion: "reduce" });
  try {
    await s.open(page);
    await page.waitForSelector(s.ready, { timeout: 25000 });
    await page.waitForTimeout(2200);
    // S1 blank-render hard-fail
    const painted = await page.evaluate(() => document.body.innerText.trim().length);
    await page.screenshot({ path: join(OUT, "design-floor", `${s.name}.png`) });
    if (painted < 20) { findings.push({ surface: s.name, sev: "P0", check: "capture", detail: "blank/near-blank render (rendering failure)" }); continue; }
    const r = await page.evaluate(pageChecks(tokens.spacing, tokens.colors), { spacingScale: tokens.spacing, tokenColors: tokens.colors });
    // S2 -> S5 severity assignment (host-side, deterministic)
    if (r.overflowPx > 1) findings.push({ surface: s.name, sev: "P1", check: "horizontal-overflow", detail: `${r.overflowPx}px past viewport (${s.width}px)` });
    for (const c of r.contrastFails) findings.push({ surface: s.name, sev: c.ratio < 3 ? "P0" : "P1", check: "contrast", detail: `${c.sel} ratio ${c.ratio}:1 (min ${c.size >= 24 ? 3 : 4.5})` });
    if (!/0s|0\.00|0\.001/.test(r.reducedMotionDur) && r.reducedMotionDur !== "n/a") findings.push({ surface: s.name, sev: "P1", check: "reduced-motion", detail: `.r-panel animation-duration ${r.reducedMotionDur} under prefers-reduced-motion` });
    if (r.hasResearchTable && !/tabular-nums/.test(r.financeTabularNums)) findings.push({ surface: s.name, sev: "P2", check: "tabular-nums", detail: `research table not tabular-nums (${r.financeTabularNums})` });
    if (r.offTokenCount > 0) findings.push({ surface: s.name, sev: "P2", check: "token-drift", detail: `${r.offTokenCount} off-token colors e.g. ${r.offTokenColors.join(", ")}` });
    console.log(`[${s.name}] scanned=${r.scanned} overflow=${r.overflowPx}px contrastFails=${r.contrastFailCount} offToken=${r.offTokenCount} rmDur=${r.reducedMotionDur} tnum=${/tabular-nums/.test(r.financeTabularNums) ? "yes" : "no"}`);
  } catch (e) {
    findings.push({ surface: s.name, sev: "P1", check: "harness", detail: e instanceof Error ? e.message.split("\n")[0] : String(e) });
  } finally { await ctx.close(); }
}
await browser.close();

// S5 ship bar
const p0 = findings.filter((f) => f.sev === "P0").length;
const p1 = findings.filter((f) => f.sev === "P1").length;
const p2 = findings.filter((f) => f.sev === "P2").length;
const ship = p0 === 0 && p1 === 0;
const report = { generatedAt: new Date().toISOString(), base: BASE, tokens: { spacingScale: tokens.spacing, colorTokens: tokens.colors.length }, counts: { P0: p0, P1: p1, P2: p2 }, shipBarMet: ship, findings };
writeFileSync(join(OUT, "design-floor.json"), JSON.stringify(report, null, 2));
console.log(`\nDESIGN FLOOR: P0=${p0} P1=${p1} P2=${p2} -> ${ship ? "SHIP (zero P0/P1)" : "BLOCKED"}`);
for (const f of findings.filter((f) => f.sev !== "P2")) console.log(`  [${f.sev}] ${f.surface} ${f.check}: ${f.detail}`);
process.exit(ship ? 0 : 1);
