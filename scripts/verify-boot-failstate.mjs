#!/usr/bin/env node
/**
 * verify-boot-failstate.mjs — prove the boot shell has a failure path.
 *
 * Three scenarios, because "it renders" is not a test:
 *   A  happy       private route boots -> shell declares loading, React replaces it
 *   B  chunk dead  the workspace module is aborted -> shell must declare FAILED,
 *                  stop shimmering, and drop the progress rail
 *   C  reduced     same failure under prefers-reduced-motion -> still failed,
 *                  still no motion, same copy (collapse to final state, not a
 *                  different design)
 *
 * Scenario B is the one that matters: before this change the only exit from
 * "Opening room" was success, so a dead chunk shimmered forever.
 */

import { chromium } from "playwright";

const BASE = "http://localhost:5260";
const ROUTE = `${BASE}/?demo=1`;
const APP_CHUNK = /\/src\/app\/main|assets\/main-.*\.js/;

const readShell = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".nr-ssr-private");
    if (!el) return { present: false };
    const line = el.querySelector(".nr-boot-line");
    const s = line ? getComputedStyle(line) : null;
    return {
      present: true,
      visible: getComputedStyle(el).display !== "none",
      state: el.getAttribute("data-boot-state"),
      ariaLabel: el.getAttribute("aria-label"),
      heading: el.querySelector(".nr-boot-status strong")?.textContent?.trim() ?? null,
      body: el.querySelector(".nr-boot-status span")?.textContent?.trim() ?? null,
      progressRail: !!el.querySelector(".nr-boot-progress"),
      lineAnimation: s ? s.animationName : null,
      lineOpacity: s ? s.opacity : null,
    };
  });

const scenario = async (browser, { name, blockChunk, reduced }) => {
  const ctx = await browser.newContext();
  if (reduced) await ctx.grantPermissions([]).catch(() => {});
  const page = await ctx.newPage();
  if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
  if (blockChunk) await page.route(APP_CHUNK, (r) => r.abort("failed"));

  // "commit" resolves once the navigation is accepted. A cold Vite dev transform
  // of the whole app graph can outlast domcontentloaded, and a timeout there
  // reads as "the page is broken" when the page is merely still compiling.
  await page.goto(ROUTE, { waitUntil: "commit", timeout: 60_000 });
  await page.locator(".nr-ssr-private").waitFor({ state: "attached", timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(blockChunk ? 5000 : 9000);
  const shell = await readShell(page);
  await ctx.close();
  return { name, shell };
};

const browser = await chromium.launch();
const results = [];
for (const s of [
  { name: "A happy", blockChunk: false, reduced: false },
  { name: "B chunk dead", blockChunk: true, reduced: false },
  { name: "C chunk dead + reduced-motion", blockChunk: true, reduced: true },
]) {
  results.push(await scenario(browser, s));
}
await browser.close();

let failures = 0;
const check = (label, pass, detail) => {
  if (!pass) failures++;
  console.log(`    ${pass ? "PASS" : "FAIL"}  ${label}${detail ? "  -> " + detail : ""}`);
};

for (const r of results) {
  const s = r.shell;
  console.log(`\n  ${r.name}`);
  console.log(`    shell present=${s.present} visible=${s.visible} state=${s.state}`);
  console.log(`    heading="${s.heading}"  rail=${s.progressRail}  anim=${s.lineAnimation} opacity=${s.lineOpacity}`);

  if (r.name.startsWith("A")) {
    check("React replaced the boot shell (or it declared loading)", !s.present || s.state === "loading", `present=${s.present} state=${s.state}`);
    continue;
  }
  // B and C: the failure path
  check("shell declares data-boot-state=failed", s.state === "failed", String(s.state));
  check("heading states the failure", /could not open/i.test(s.heading ?? ""), s.heading ?? "null");
  check("progress rail removed (no false progress)", s.progressRail === false);
  check("skeleton stopped shimmering", s.lineAnimation === "none", String(s.lineAnimation));
  check("aria-label no longer says Loading", !/loading/i.test(s.ariaLabel ?? ""), s.ariaLabel ?? "null");
}

// C must be identical to B in substance: reduced motion collapses to the final
// state, it does not produce a different design.
const b = results.find((r) => r.name.startsWith("B"))?.shell;
const c = results.find((r) => r.name.startsWith("C"))?.shell;
console.log("\n  B vs C (reduced motion must not change the design)");
check("same state", b?.state === c?.state, `${b?.state} vs ${c?.state}`);
check("same heading", b?.heading === c?.heading);
check("same body copy", b?.body === c?.body);

console.log(`\n  ${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exitCode = failures === 0 ? 0 : 1;
