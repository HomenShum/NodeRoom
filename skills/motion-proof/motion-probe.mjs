#!/usr/bin/env node
/**
 * motion-probe.mjs — the deterministic PRIMARY instrument for motion-proof.
 *
 * WHY THIS FILE EXISTS. An audit on 2026-07-28 found motion-proof inverted in
 * practice: SKILL.md correctly demotes the video judge to advisory and names
 * `Element.getAnimations()` as primary, but getAnimations() had ZERO executable
 * callers anywhere — three hits, all prose — while six working Gemini
 * video-judge scripts shipped. The only running motion instrument was the one
 * the council demoted. A skill that documents rigour it does not perform is a
 * vacuous pass about vacuous passes.
 *
 * This binds animations to the DECLARED SUBJECT rather than counting them
 * page-wide, because a count is exactly what the decoy fixture defeats.
 *
 * Usage:
 *   node motion-probe.mjs                 # run the whole deception corpus
 *   node motion-probe.mjs <url|file>      # probe one page
 *
 * Exit 0 only if the control passes AND every deception is caught.
 */
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");

/**
 * Playwright is a PEER, never a dependency of this skill — the same split
 * noderoom/scripts/playwright-peer.mjs draws: the gate owns the grammar, the
 * consuming repository owns the runtime. A skill that drags a browser engine
 * into ~/.claude has traded that claim for a bundle.
 *
 * A skill also lives outside any repo, so a bare import resolves only when the
 * cwd happens to have playwright installed. Resolve from candidate consumer
 * roots instead, and FAIL CLOSED when none has it. "No browser, so no findings,
 * so PASS" is the exact vacuous pass this file exists to catch.
 */
const loadChromium = async () => {
  const roots = [
    process.cwd(),
    "D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/noderoom",
    "D:/VSCode Projects/nodeslide",
    "D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/FeatureClipStudio",
  ];
  for (const root of roots) {
    try {
      const require = createRequire(join(root, "package.json"));
      const pw = require("playwright");
      // Module resolving is not the capability existing: `npm i playwright`
      // without `npx playwright install chromium` imports fine and dies later at
      // launch(). Prove the BROWSER, not the package — executablePath() is sync
      // and launches nothing.
      const exe = pw.chromium.executablePath?.();
      if (exe && !existsSync(exe)) continue;
      return pw.chromium;
    } catch {
      /* try the next root */
    }
  }
  throw new Error(
    [
      "motion-probe requires Playwright, which this skill deliberately does not depend on.",
      "",
      "  Install it in a repository being audited, not in ~/.claude:",
      "      npm install --save-dev playwright && npx playwright install chromium",
      "",
      "  This exits non-zero rather than skipping. A gate that cannot reach a browser",
      "  has NOT RUN, and not-run is never a pass.",
    ].join("\n"),
  );
};
const chromium = await loadChromium();

/**
 * Read the page's real animation state.
 *
 * Two runner obligations from genjutsu.yaml are implemented here, both of them
 * real defects found in this session's own tooling:
 *   - PAINTED ONLY: getComputedStyle reports animationName for elements inside
 *     display:none subtrees, so hidden animations are counted SEPARATELY and
 *     never folded into the visible total.
 *   - Bind to the subject: `[data-subject]` is the declared thing under test.
 *     An animation running somewhere else on the page is not evidence about it.
 */
const readMotion = async (page, subjectSel) =>
  page.evaluate((SUBJECT_SEL) => {
    const painted = (el) => {
      if (!(el instanceof Element)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      // Off-screen decoys are not painted for our purposes.
      if (r.right < 0 || r.bottom < 0) return false;
      if (r.left > innerWidth || r.top > innerHeight) return false;
      const s = getComputedStyle(el);
      // NOTE: opacity is deliberately NOT part of this test. The control fixture
      // caught the first draft rejecting honest motion: an enter animation starts
      // at opacity 0, so treating opacity-0 as "not painted" made the instrument
      // blind to the single most common legitimate animation. Layout presence and
      // display/visibility are the paint test; opacity is frequently the animated
      // property itself and is reported, not filtered on.
      return s.display !== "none" && s.visibility !== "hidden";
    };

    const all = document.getAnimations();
    const describe = (a) => {
      const t = a.effect?.target ?? null;
      const timing = a.effect?.getComputedTiming?.() ?? {};
      return {
        id: a.animationName ?? a.id ?? "(anonymous)",
        playState: a.playState,
        duration: typeof timing.duration === "number" ? Math.round(timing.duration) : String(timing.duration ?? ""),
        iterations: timing.iterations ?? 1,
        target: t ? t.tagName.toLowerCase() + (t.className ? "." + String(t.className).split(/\s+/)[0] : "") : "(none)",
        onSubject: !!(t && t.closest?.(SUBJECT_SEL)),
        painted: t ? painted(t) : false,
      };
    };

    const anims = all.map(describe);
    const subject = document.querySelector(SUBJECT_SEL);

    return {
      total: anims.length,
      onSubjectPainted: anims.filter((a) => a.onSubject && a.painted).length,
      offSubject: anims.filter((a) => !a.onSubject).length,
      hidden: anims.filter((a) => !a.painted).length,   // reported separately, never folded in
      animations: anims,
      subjectPresent: !!subject,
      // Trust-surface sweep is structural and runs every time, independent of rubric.
      trustSurfaces: [...document.querySelectorAll("[data-trust-surface]")].map((el) => ({
        kind: el.getAttribute("data-trust-surface"),
        state: el.getAttribute("data-state"),
        decision: el.querySelector("[data-decision]")?.getAttribute("data-decision") ?? null,
        animatedDescendants: document.getAnimations().filter((a) => {
          const t = a.effect?.target;
          return t instanceof Element && el.contains(t);
        }).length,
      })),
      finalState: subject
        ? (() => {
            const s = getComputedStyle(subject);
            return { opacity: s.opacity, transform: s.transform, width: s.width, background: s.backgroundColor, borderRadius: s.borderRadius };
          })()
        : null,
      visibleText: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200),
    };
  }, subjectSel);

/**
 * Probe one page in both the normal and reduced-motion contexts.
 *
 * `nudge` exists because a deferred-boot app (NodeRoom defers its app module
 * until first interaction) serves an SSR shell that has no animations and none
 * of the product's real markup. Probing that shell and reporting "no motion"
 * would be a true statement about the wrong page.
 */
const probe = async (browser, url, opts = {}) => {
  const subjectSel = opts.subject ?? "[data-subject]";
  const nudge = opts.nudge ?? false;
  const findings = [];

  const open = async (ctx) => {
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: "load", timeout: 30_000 });
    if (nudge) {
      await p.mouse.move(450, 300);
      await p.mouse.wheel(0, 1);
      await p.waitForTimeout(2500);            // let the deferred module mount
    }
    return p;
  };

  const ctxNormal = await browser.newContext({ viewport: { width: 900, height: 600 } });
  const p1 = await open(ctxNormal);
  await p1.waitForTimeout(60);                 // sample while motion should still be running
  const during = await readMotion(p1, subjectSel);
  await p1.waitForTimeout(1600);               // let everything settle
  const after = await readMotion(p1, subjectSel);
  await ctxNormal.close();

  const ctxReduced = await browser.newContext({ viewport: { width: 900, height: 600 }, reducedMotion: "reduce" });
  const p2 = await open(ctxReduced);
  await p2.waitForTimeout(1600);
  const reduced = await readMotion(p2, subjectSel);
  await ctxReduced.close();

  // --- deterministic verdicts -------------------------------------------------

  // 1. Did anything animate ON THE DECLARED SUBJECT? A page-wide count would be
  //    satisfied by an off-screen decoy, which is fixture 02.
  if (during.onSubjectPainted === 0) {
    findings.push(
      during.total > 0
        ? `NO MOTION ON SUBJECT — ${during.total} animation(s) running, none on a painted [data-subject] (${during.offSubject} off-subject, ${during.hidden} unpainted)`
        : "NO MOTION AT ALL — getAnimations() returned zero; any recording claiming motion does not match this page",
    );
  }

  // 2. Subject must exist. A perfect keyframe on an unmounted element is a spec
  //    claim, not a proof.
  if (!during.subjectPresent) findings.push("SUBJECT ABSENT — [data-subject] is not in the DOM; the declared motion cannot have run");

  // 3. Trust-surface sweep. Motion here is a correctness finding at any duration.
  for (const ts of during.trustSurfaces) {
    if (ts.animatedDescendants > 0) {
      findings.push(
        `TRUST SURFACE ANIMATES — <${ts.kind}> state=${ts.state} decision=${ts.decision}: ` +
          `${ts.animatedDescendants} animation(s) inside an undecided decision surface`,
      );
    }
  }

  // 4. Reduced motion must reach the SAME final state, not a second design.
  if (after.finalState && reduced.finalState) {
    // `none` and the identity matrix are the SAME final state. Comparing computed
    // transform strings raw reported the honest control as a different design —
    // a false positive that would have taught a user to distrust this check.
    const norm = (k, v) =>
      k === "transform" && (v === "none" || /^matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)$/.test(v)) ? "identity" : v;
    const diffs = Object.keys(after.finalState).filter(
      (k) => norm(k, after.finalState[k]) !== norm(k, reduced.finalState[k]),
    );
    if (diffs.length) {
      findings.push(
        `REDUCED-MOTION IS A DIFFERENT DESIGN — differs on ${diffs.join(", ")} ` +
          `(normal ${diffs.map((k) => k + "=" + after.finalState[k]).join(" ")} | reduced ${diffs.map((k) => k + "=" + reduced.finalState[k]).join(" ")})`,
      );
    }
  }
  if (after.visibleText !== reduced.visibleText) {
    findings.push("REDUCED-MOTION CHANGES CONTENT — visible text differs between the two paths");
  }

  // 5. Knockout must remove the MECHANISM, not scrub to the end. If ?knockout
  //    yields the same final state AND the animation still existed, the timeline
  //    was constructed and fast-forwarded — the deception this skill shipped itself.
  // Opt-in only. `?knockout=scrub` is a convention the SUBJECT must implement;
  // firing it at a product that has never heard of it navigates to a URL that
  // does not exist and reports a timeout as if it were a motion finding.
  if (opts.knockout) {
    const ctxK = await browser.newContext({ viewport: { width: 900, height: 600 } });
    const pk = await ctxK.newPage();
    const ksep = url.includes("?") ? "&" : "?";
    await pk.goto(`${url}${ksep}knockout=scrub`, { waitUntil: "load", timeout: 30_000 });
    await pk.waitForTimeout(120);
    const k = await readMotion(pk, subjectSel);
    await ctxK.close();
    const sameFinal = JSON.stringify(k.finalState) === JSON.stringify(after.finalState);
    if (k.total > 0 && sameFinal && during.onSubjectPainted > 0) {
      findings.push(
        "KNOCKOUT SCRUBS TO END — under ?knockout the timeline still exists and the final state is identical; " +
          "the mechanism was fast-forwarded, not removed, so the knockout passes vacuously",
      );
    }
  }

  return { url, during, after, reduced, findings };
};

// --- corpus runner ------------------------------------------------------------

const browser = await chromium.launch();
const arg = process.argv[2];

if (arg) {
  const url = /^https?:/.test(arg) ? arg : pathToFileURL(arg).href;
  const flag = (name) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? (process.argv[i + 1] ?? true) : undefined;
  };
  // Unrecognised flags must FAIL, never silently no-op — a runner that skips a
  // typo'd instruction produces a clean-looking report of something it never did.
  const known = new Set(["--subject", "--nudge", "--knockout"]);
  for (const a of process.argv.slice(3)) {
    if (a.startsWith("--") && !known.has(a)) throw new Error(`unknown flag ${a} — known: ${[...known].join(", ")}`);
  }
  const subject = flag("--subject");
  const r = await probe(browser, url, { subject, nudge: !!flag("--nudge"), knockout: !!flag("--knockout") });
  if (!subject) console.log("  (no --subject declared; defaulting to [data-subject], which real products rarely carry)");
  console.log(`\n${url}`);
  console.log(`  animations: total=${r.during.total} onSubjectPainted=${r.during.onSubjectPainted} offSubject=${r.during.offSubject} hidden=${r.during.hidden}`);
  for (const a of r.during.animations) console.log(`    ${a.id} ${a.playState} ${a.duration}ms target=${a.target} onSubject=${a.onSubject} painted=${a.painted}`);
  console.log(r.findings.length ? "  FINDINGS:" : "  no deterministic findings");
  for (const f of r.findings) console.log(`    - ${f}`);
  // Never emit a blended score: this reports the deterministic layer only.
  console.log(`\n  Deterministic proof:  ${r.findings.length ? "FAIL" : "PASS"}`);
  console.log("  Video semantic judge: not run (advisory layer)");
  console.log("  Human review:         pending");
  process.exitCode = 0;
} else {
  const files = (await readdir(FIXTURES)).filter((f) => f.endsWith(".html")).sort();
  let bad = 0;
  console.log(`motion-probe — deception corpus (${files.length} fixtures)\n`);
  for (const f of files) {
    const isControl = f.startsWith("00-");
    // Fixtures implement the ?knockout convention, so the check is live here.
    const r = await probe(browser, pathToFileURL(join(FIXTURES, f)).href, { knockout: true });
    const caught = r.findings.length > 0;
    // The control must PASS. Every deception must be CAUGHT. A runner that only
    // ever passes has not been shown to detect anything.
    const ok = isControl ? !caught : caught;
    if (!ok) bad++;
    console.log(`${ok ? "OK  " : "MISS"}  ${f}`);
    console.log(`        ${isControl ? "control, expected clean" : "deception, expected caught"} — total=${r.during.total} onSubject=${r.during.onSubjectPainted} offSubject=${r.during.offSubject} hidden=${r.during.hidden}`);
    for (const finding of r.findings) console.log(`        · ${finding}`);
    console.log();
  }
  console.log(bad === 0
    ? "corpus verified — control passes, all deceptions caught"
    : `${bad} fixture(s) behaved wrongly — the instrument is not trustworthy until this is 0`);
  process.exitCode = bad === 0 ? 0 : 1;
}

// Do NOT browser.close() a connectOverCDP connection — this one we launched, so
// closing it is correct and required.
await browser.close();
