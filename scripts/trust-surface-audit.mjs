#!/usr/bin/env node
/**
 * trust-surface-audit.mjs — run the `trust-surfaces` gate against LIVE pages over CDP.
 *
 * Clause 1  Inspectable      — decision state readable from the DOM, not only in a store.
 * Clause 2  Not styled to    — no motion on decision affordances; no acceptance styling
 *           imply an outcome   on anything whose declared state is pending.
 *
 * Two rules the skill is explicit about, and this script obeys both:
 *   - "A surface missing from the enumeration is not-run, never passed."
 *   - The gate asserts the consent attribute EXISTS, not just its value when present.
 *
 * Attaches to an already-running Chrome (connectOverCDP). Does not launch, does not
 * close the user's browser.
 */

import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const PORT = 9222;
const OUT = "C:/Users/hshum/AppData/Local/Temp/claude/C--Users-hshum-Downloads-Interview-items/e3836513-f1aa-4c47-9924-c47e6c3b1b3e/scratchpad/trust-audit.json";

const TARGETS = [
  { app: "NodeRoom", url: "http://localhost:5260/", proof: "Review every change" },
  { app: "NodeSlide", url: "http://localhost:5180/", proof: "What presentation should we build" },
];

/** Runs IN the page. Returns facts only — no verdicts; verdicts are computed here, in Node. */
const PROBE = () => {
  const TRUST_WORDS = /(propos|conflict|failed|failure|error|diff|review|approve|reject|accept|decline|consent|permission|grant|confirm|pending|unsaved|discard)/i;
  const DECISION_VERB = /^(accept|approve|reject|decline|confirm|discard|allow|deny|grant|apply|commit|merge|dismiss|undo|revert)\b/i;
  const SUCCESS_HINT = /(success|verified|accepted|approved|confirmed|complete|done|valid|passed|ok\b)/i;

  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };

  // --- Clause 1: what does the DOM advertise at all? -----------------------
  const dataAttrs = {};
  for (const el of document.querySelectorAll("*")) {
    for (const a of el.attributes) {
      if (a.name.startsWith("data-")) dataAttrs[a.name] = (dataAttrs[a.name] ?? 0) + 1;
    }
  }
  const consentAttrs = Object.keys(dataAttrs).filter((k) => /consent|permission|agent-web/i.test(k));
  const stateAttrs = Object.keys(dataAttrs).filter((k) => /state|status|pending|decision|posture/i.test(k));

  // --- Enumerate candidate trust surfaces ---------------------------------
  const surfaces = [];
  for (const el of document.querySelectorAll("[data-testid],[role='dialog'],[role='alertdialog'],[role='alert'],section,aside,form")) {
    if (!vis(el)) continue;
    const tid = el.getAttribute("data-testid") ?? "";
    const text = (el.innerText || "").slice(0, 400);
    if (!TRUST_WORDS.test(tid + " " + text)) continue;
    if (el.innerText && el.innerText.length > 3000) continue; // whole-page wrappers are not surfaces
    surfaces.push({
      tag: el.tagName.toLowerCase(),
      testid: tid || null,
      role: el.getAttribute("role") || null,
      matched: (tid + " " + text).match(TRUST_WORDS)?.[0] ?? null,
      declaredState: el.getAttribute("data-state") ?? el.getAttribute("data-status") ?? null,
      snippet: text.replace(/\s+/g, " ").slice(0, 120),
    });
  }

  // --- Clause 2: decision affordances and their computed styles ------------
  const affordances = [];
  for (const el of document.querySelectorAll("button,[role='button'],a[href],input[type=submit]")) {
    if (!vis(el)) continue;
    const label = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
    if (!label || !DECISION_VERB.test(label)) continue;
    const s = getComputedStyle(el);
    const hasMotion =
      (s.transitionDuration && s.transitionDuration.split(",").some((d) => parseFloat(d) > 0)) ||
      (s.animationName && s.animationName !== "none");
    affordances.push({
      label: label.slice(0, 60),
      classes: el.className?.toString?.().slice(0, 120) ?? "",
      declaredState: el.getAttribute("data-state") ?? el.getAttribute("data-status") ?? null,
      transitionDuration: s.transitionDuration,
      transitionProperty: s.transitionProperty?.slice(0, 80),
      animationName: s.animationName,
      hasMotion,
      successStyled: SUCCESS_HINT.test(el.className?.toString?.() ?? ""),
    });
  }

  // --- Infinite / long animations anywhere (V9 signal) --------------------
  let infinite = 0;
  let over400 = 0;
  for (const el of document.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    if (s.animationName && s.animationName !== "none") {
      if (s.animationIterationCount.split(",").some((c) => c.trim() === "infinite")) infinite++;
      if (s.animationDuration.split(",").some((d) => parseFloat(d) > 0.4)) over400++;
    }
    if (s.transitionDuration && s.transitionDuration.split(",").some((d) => parseFloat(d) > 0.4)) over400++;
  }

  return {
    title: document.title,
    dataAttrCount: Object.keys(dataAttrs).length,
    consentAttrs,
    stateAttrs,
    surfaces,
    affordances,
    motion: { infinite, over400 },
  };
};

const run = async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15_000 });
  const ctx = browser.contexts()[0];
  const report = { generatedAtNote: "stamped by caller", cdp: `:${PORT}`, targets: [] };

  for (const t of TARGETS) {
    const page = await ctx.newPage();
    const entry = { app: t.app, url: t.url };
    try {
      await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      // Proof selector, not a timeout: a blank page must fail, not pass empty.
      await page.getByText(t.proof, { exact: false }).first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      entry.probe = await page.evaluate(PROBE);
      entry.status = "probed";
    } catch (e) {
      entry.status = "NOT_RUN";
      entry.reason = e.message.split("\n")[0].slice(0, 160);
    }
    await page.close();
    report.targets.push(entry);
  }

  // Do NOT browser.close() a connectOverCDP connection — it kills the real Chrome.
  return report;
};

let report;
try {
  report = await run();
} catch (e) {
  report = { fatal: e.message.split("\n")[0] };
}
await writeFile(OUT, JSON.stringify(report, null, 2), "utf8");

// Terse console summary; the JSON is the artifact.
for (const t of report.targets ?? []) {
  if (t.status !== "probed") {
    console.log(`${t.app}: NOT_RUN - ${t.reason}`);
    continue;
  }
  const p = t.probe;
  console.log(
    `${t.app}: surfaces=${p.surfaces.length} affordances=${p.affordances.length} ` +
      `consentAttrs=${p.consentAttrs.length} stateAttrs=${p.stateAttrs.length} ` +
      `motion(inf=${p.motion.infinite},>400ms=${p.motion.over400})`,
  );
}
if (report.fatal) console.log(`FATAL ${report.fatal}`);
