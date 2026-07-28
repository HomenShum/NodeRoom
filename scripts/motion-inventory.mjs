#!/usr/bin/env node
/**
 * motion-inventory.mjs — name every animation on a live page, and check the one
 * thing a count cannot tell you: does it collapse under prefers-reduced-motion?
 *
 * `motion-proof` refuses to pass motion that was never observed running, and
 * motion-ladder's four numbers are pass/fail. A count of 17 infinite animations
 * is not a finding; 17 NAMED animations, each with a verdict under reduced
 * motion, is.
 *
 * Runs each page twice over CDP: default, then emulated reduced-motion. An
 * animation that survives the second pass is the defect.
 */

import { requireChromium } from "./playwright-peer.mjs";
const chromium = await requireChromium("motion-inventory");
import { writeFile } from "node:fs/promises";

const PORT = 9222;
const OUT = "C:/Users/hshum/AppData/Local/Temp/claude/C--Users-hshum-Downloads-Interview-items/e3836513-f1aa-4c47-9924-c47e6c3b1b3e/scratchpad/motion-inventory.json";

const TARGETS = [
  { app: "NodeRoom", url: "http://localhost:5260/", proof: "Review every change" },
  { app: "NodeSlide", url: "http://localhost:5180/", proof: "What presentation should we build" },
];

const PROBE = () => {
  const path = (el) => {
    const bits = [];
    for (let n = el; n && n.nodeType === 1 && bits.length < 4; n = n.parentElement) {
      const cls = (n.className?.toString?.() ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      bits.unshift(n.tagName.toLowerCase() + (cls ? "." + cls : ""));
    }
    return bits.join(" > ");
  };

  // getComputedStyle reports animationName for elements inside a display:none
  // subtree. An animation that never paints is not motion a user experiences,
  // and counting it inflates the number that decides a V9 verdict. Visibility
  // is part of the measurement, not a nicety.
  const painted = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    }
    return true;
  };

  const out = [];
  const hidden = { count: 0, names: new Set() };
  for (const el of document.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    const names = (s.animationName || "none").split(",").map((x) => x.trim());
    if (names.every((n) => n === "none")) continue;
    if (!painted(el)) {
      hidden.count++;
      names.forEach((n) => n !== "none" && hidden.names.add(n));
      continue;
    }
    const counts = s.animationIterationCount.split(",").map((x) => x.trim());
    const durs = s.animationDuration.split(",").map((x) => parseFloat(x) || 0);
    names.forEach((n, i) => {
      if (n === "none") return;
      out.push({
        name: n,
        iterations: counts[i] ?? counts[0] ?? "1",
        durationS: durs[i] ?? durs[0] ?? 0,
        playState: s.animationPlayState.split(",")[i]?.trim() ?? s.animationPlayState,
        where: path(el),
      });
    });
  }
  // Collapse duplicates: 12 copies of one keyframe is one defect, not twelve.
  const byKey = new Map();
  for (const a of out) {
    const k = `${a.name}|${a.iterations}|${a.durationS}`;
    const hit = byKey.get(k);
    if (hit) { hit.count++; if (hit.examples.length < 3) hit.examples.push(a.where); }
    else byKey.set(k, { ...a, count: 1, examples: [a.where], where: undefined });
  }
  return {
    visible: [...byKey.values()].sort((a, b) => b.count - a.count),
    // Reported, never silently dropped: a hidden animation is not a user-facing
    // defect, but it IS the difference between two very different numbers.
    hiddenElements: hidden.count,
    hiddenNames: [...hidden.names],
  };
};

const sweep = async (ctx, t, reduced) => {
  const page = await ctx.newPage();
  if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
  try {
    await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByText(t.proof, { exact: false }).first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1800);
    const r = await page.evaluate(PROBE);
    await page.close();
    return { status: "ok", rows: r.visible, hiddenElements: r.hiddenElements, hiddenNames: r.hiddenNames };
  } catch (e) {
    await page.close();
    return { status: "NOT_RUN", reason: e.message.split("\n")[0].slice(0, 140), rows: [], hiddenElements: 0, hiddenNames: [] };
  }
};

// Prefer an already-running Chrome over CDP; fall back to launching one. The
// fallback matters because a script that dies when someone closes their browser
// is not a gate, and localhost needs no signed-in session anyway.
let browser;
let transport;
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 8_000 });
  transport = `attached over CDP :${PORT}`;
} catch {
  browser = await chromium.launch();
  transport = "launched own chromium (CDP endpoint unreachable)";
}
console.log(`  transport: ${transport}`);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const report = [];

for (const t of TARGETS) {
  const normal = await sweep(ctx, t, false);
  const reduced = await sweep(ctx, t, true);
  report.push({ app: t.app, url: t.url, normal, reduced });
}
await browser.close();
await writeFile(OUT, JSON.stringify(report, null, 2), "utf8");

for (const r of report) {
  console.log(`\n=== ${r.app}`);
  if (r.normal.status !== "ok") { console.log(`  NOT_RUN ${r.normal.reason}`); continue; }
  const inf = r.normal.rows.filter((x) => x.iterations === "infinite");
  console.log(`  animations: ${r.normal.rows.length} distinct, ${r.normal.rows.reduce((a, b) => a + b.count, 0)} PAINTED elements`);
  console.log(`  infinite:   ${inf.length} distinct (painted)`);
  console.log(`  hidden:     ${r.normal.hiddenElements} element(s) animate inside a non-painted subtree -> not user-facing`);
  if (r.normal.hiddenNames.length) console.log(`              [${r.normal.hiddenNames.join(", ")}]`);
  for (const a of r.normal.rows) {
    console.log(`    ${a.name.padEnd(22)} x${String(a.count).padStart(2)}  ${String(a.durationS)}s  iter=${a.iterations}`);
    console.log(`      at ${a.examples[0]}`);
  }
  if (r.reduced.status !== "ok") { console.log(`  reduced-motion pass: NOT_RUN ${r.reduced.reason}`); continue; }
  const survivors = r.reduced.rows.filter((x) => x.durationS > 0.01);
  console.log(`  under prefers-reduced-motion: ${survivors.length} distinct animation(s) SURVIVE`);
  for (const a of survivors) console.log(`    SURVIVES  ${a.name} x${a.count} ${a.durationS}s iter=${a.iterations}`);
}
