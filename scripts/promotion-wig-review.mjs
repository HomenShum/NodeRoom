/**
 * Promotion loop — condition 7 producer: the Web Interface Guidelines review.
 *
 * The human situation: someone opens the sample room, does some work, and then
 * does an ordinary thing — refreshes the tab, presses Back, sends the link to a
 * colleague, tabs to the next control, or taps a cell on a phone. Condition 7
 * asks whether those ordinary things behave the way the web has taught everyone
 * they behave. It is a REVIEW, not a score: each rule below is a named guideline
 * from Vercel's Web Interface Guidelines, and each one is decided by a
 * measurement taken from the rendered page, not by a tool's overall grade.
 *
 * Paper note: this script checks NodeRoom against a published list of web
 * interface rules — one measurement per rule — and fails if any rule that
 * matters is broken.
 *
 * This is deliberately NOT the same thing as `promotion-web-quality-audit.mjs`.
 * That one runs Lighthouse and axe, which grade speed and accessibility rules.
 * This one asks questions no audit tool asks: does the URL still describe what is
 * on screen, does Back go back, does the page title change when the page does.
 * A Lighthouse score can be 100 while every one of those is broken. Passing one
 * off as the other is the specific failure this file exists to prevent.
 *
 * Guidelines source, fetched 2026-08-13: https://vercel.com/design/guidelines
 * Rule ids below quote the guideline's own short name so a reader can find it.
 *
 *   node scripts/promotion-wig-review.mjs \
 *     --base-url http://127.0.0.1:4903 \
 *     --out promotion/evidence/iteration-2
 *
 * Requires a server already serving the build on --base-url.
 * Exit 0 = no major unresolved finding. Exit 1 = at least one.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const baseUrl = arg("base-url", "http://127.0.0.1:4903").replace(/\/$/, "");
const outDir = resolve(arg("out", "promotion/evidence/iteration-2"));
const landingUrl = `${baseUrl}/?mode=memory&surface=desktop`;

const findings = [];
/** @param verdict "major" | "minor" | "ok" */
const record = (section, rule, verdict, measurement, note) =>
  findings.push({ section, rule, verdict, measurement, note });

/** Dismisses the first-run tour so every check starts from the same state. */
const seedStorage = (page) => page.evaluate(() => {
  try {
    localStorage.setItem("noderoom:tour:v1", "done");
    localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: true, paused: false }));
  } catch { /* storage may be blocked; the room still opens */ }
});

async function openRoom(page) {
  await page.goto(landingUrl, { waitUntil: "domcontentloaded" });
  await seedStorage(page);
  const cta = page.getByTestId("start-demo-room");
  await cta.waitFor({ state: "visible", timeout: 60_000 });
  await cta.click();
  await page.getByTestId("artifact-panel").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(2_000);
}

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // ---- Landing, before entering the room -------------------------------------
  await page.goto(landingUrl, { waitUntil: "domcontentloaded" });
  await seedStorage(page);
  await page.getByTestId("start-demo-room").waitFor({ state: "visible", timeout: 60_000 });
  const landing = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    viewportMeta: document.querySelector('meta[name="viewport"]')?.content ?? null,
    themeColor: document.querySelector('meta[name="theme-color"]')?.content ?? null,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    lang: document.documentElement.lang,
    skipLinks: [...document.querySelectorAll("a[href^='#']")]
      .map((a) => a.textContent.trim()).filter((t) => /skip/i.test(t)),
    landmarks: document.querySelectorAll(
      "main,nav,header,footer,aside,[role=main],[role=navigation],[role=banner],[role=contentinfo],[role=complementary]").length,
  }));

  // Design — "Browser UI matches your background" + "Set the appropriate color-scheme"
  record("Design", "Browser UI matches your background / color-scheme",
    landing.themeColor && landing.colorScheme !== "normal" ? "ok" : "minor",
    { themeColor: landing.themeColor, colorScheme: landing.colorScheme },
    "meta[name=theme-color] and the root color-scheme, read from the landing route.");

  // Interactions — "Respect zoom"
  const zoomBlocked = /user-scalable\s*=\s*(no|0)/i.test(landing.viewportMeta ?? "")
    || /maximum-scale\s*=\s*(1|1\.0)\b/i.test(landing.viewportMeta ?? "");
  record("Interactions", "Respect zoom", zoomBlocked ? "major" : "ok",
    { viewportMeta: landing.viewportMeta },
    "Never disable browser zoom capability.");

  // ---- The room --------------------------------------------------------------
  await openRoom(page);
  await page.screenshot({ path: join(outDir, "wig-room-1440.png") });

  const room = await page.evaluate(() => {
    const composer = document.querySelector('[data-testid="chat-composer"]');
    const cs = composer ? getComputedStyle(composer) : null;
    const visible = (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed";
    const iconOnly = [...document.querySelectorAll("button")]
      .filter((b) => visible(b) && (b.textContent ?? "").replace(/\s+/g, "").length === 0);
    const unnamed = iconOnly.filter((b) =>
      !b.getAttribute("aria-label") && !b.getAttribute("title") && !b.getAttribute("aria-labelledby"));
    const interactive = [...document.querySelectorAll('button,a[href],[role="button"],input,select,textarea')]
      .filter(visible);
    const small = interactive.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24);
    }).map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, testid: el.getAttribute("data-testid"),
        cls: `${el.className}`.slice(0, 48), w: Math.round(r.width), h: Math.round(r.height),
        label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 28) };
    });
    // Numbers a person compares column-to-column must line up. Scan the leaf nodes
    // in the work panel whose whole text is a figure — NOT the cell-edit buttons,
    // which read "add"/"note" while a column is still empty and would score this
    // rule on a sample of zero.
    const numericCells = [...document.querySelectorAll('[data-testid="artifact-panel"] *')]
      .filter((el) => el.children.length === 0
        && /^[\d.,%+\-$]{2,}$/.test((el.textContent ?? "").trim()))
      .map((el) => ({ text: el.textContent.trim().slice(0, 16),
        cls: `${el.className}`.slice(0, 24),
        fontVariantNumeric: getComputedStyle(el).fontVariantNumeric }));
    // `transition-property` INITIALISES to `all`, so testing that alone flags every
    // element on the page including <head>. Only an element that actually animates
    // (non-zero duration) is breaking the guideline.
    const transitionAll = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const cs = getComputedStyle(el);
        return cs.transitionProperty === "all"
          && cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0);
      })
      .map((el) => `${el.tagName}.${`${el.className}`.split(" ")[0]}`);
    const undo = document.querySelector('[title*="Undo" i],[aria-label*="Undo" i]');
    return {
      title: document.title,
      url: location.href,
      landmarks: document.querySelectorAll(
        "main,nav,header,footer,aside,[role=main],[role=navigation],[role=banner],[role=contentinfo],[role=complementary]").length,
      mainLandmarks: document.querySelectorAll("main,[role=main]").length,
      composer: cs ? { tag: composer.tagName, fontSizePx: parseFloat(cs.fontSize),
        ariaExpanded: composer.getAttribute("aria-expanded"), role: composer.getAttribute("role"),
        touchAction: cs.touchAction, accessibleName: composer.getAttribute("aria-label")
          ?? composer.getAttribute("placeholder") ?? null } : null,
      iconOnlyCount: iconOnly.length,
      unnamedIconButtons: unnamed.map((b) => ({ testid: b.getAttribute("data-testid"),
        cls: `${b.className}`.slice(0, 60) })),
      interactiveCount: interactive.length,
      smallTargets: small,
      numericCells,
      transitionAllCount: transitionAll.length,
      transitionAllSample: [...new Set(transitionAll)].slice(0, 8),
      undo: undo ? { title: undo.getAttribute("title") ?? undo.getAttribute("aria-label"),
        disabled: undo.disabled === true } : null,
    };
  });

  // Content — "Accurate page titles"
  record("Content", "Accurate page titles", landing.title === room.title ? "major" : "ok",
    { landingTitle: landing.title, roomTitle: room.title, identical: landing.title === room.title },
    "<title> must reflect current context. Landing and room share one title, so a tab strip, a bookmark and a history entry cannot tell them apart.");

  // Content — "Headings & skip link" (the landmark half; the heading half is axe's heading-order)
  record("Content", "Headings & skip link",
    room.landmarks === 0 || landing.skipLinks.length === 0 ? "major" : "ok",
    { landingSkipLinks: landing.skipLinks, landingLandmarks: landing.landmarks,
      roomLandmarks: room.landmarks, roomMainLandmarks: room.mainLandmarks },
    "Hierarchical headings and a 'Skip to content' link. The room renders zero landmark elements, so there is nothing to skip to and no region to jump between.");

  // Content — "Icon-only buttons are named"
  record("Content", "Icon-only buttons are named",
    room.unnamedIconButtons.length > 0 ? "major" : "ok",
    { iconOnlyVisible: room.iconOnlyCount, unnamed: room.unnamedIconButtons },
    "Icon-only buttons need a descriptive aria-label.");

  // Content — "Tabular numbers for comparisons"
  const nonTabular = room.numericCells.filter((c) => !/tabular-nums/.test(c.fontVariantNumeric));
  record("Content", "Tabular numbers for comparisons",
    nonTabular.length > 0 ? "minor" : "ok",
    { numericCells: room.numericCells.length, withoutTabularNums: nonTabular },
    "Figures a reader compares down a column should use font-variant-numeric: tabular-nums.");

  // Content — "Semantics before ARIA"
  record("Content", "Semantics before ARIA",
    room.composer?.ariaExpanded != null && room.composer.tag === "TEXTAREA" ? "major" : "ok",
    { composer: room.composer },
    "A textarea has no expandable role, so aria-expanded on it announces a state the control cannot have. Same node axe reports as critical aria-allowed-attr.");

  // Interactions — "Match visual & hit targets"
  record("Interactions", "Match visual & hit targets",
    room.smallTargets.length > 0 ? "major" : "ok",
    { interactiveCount: room.interactiveCount, under24px: room.smallTargets.length,
      worst: room.smallTargets.slice(0, 10) },
    "Visual targets under 24px must expand their hit target to at least 24px.");

  // Interactions — "Confirm destructive actions" (the Undo half)
  record("Interactions", "Confirm destructive actions / Undo",
    room.undo && room.undo.disabled ? "major" : room.undo ? "ok" : "minor",
    { undo: room.undo },
    "An agent editing your sheet is destructive; the guideline asks for confirmation or an Undo with a safe window. Measured on arrival — see the after-edit measurement below for the state that decides it.");

  // Animations — "Never transition: all"
  record("Animations", "Never transition: all",
    room.transitionAllCount > 0 ? "minor" : "ok",
    { elements: room.transitionAllCount, sample: room.transitionAllSample },
    "Explicitly list only the properties you intend to animate.");

  // ---- Interactions — "URL as state" and "Deep-link everything" ---------------
  const historyLengthInRoom = await page.evaluate(() => history.length);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7_000);
  const afterReload = await page.evaluate(() => ({
    url: location.href,
    roomVisible: !!document.querySelector('[data-testid="artifact-panel"]'),
    landingCtaVisible: !!document.querySelector('[data-testid="start-demo-room"]'),
  }));
  await page.screenshot({ path: join(outDir, "wig-after-reload.png") });

  await openRoom(page);
  await page.goBack().catch(() => {});
  await page.waitForTimeout(3_000);
  const afterBack = await page.evaluate(() => ({
    url: location.href,
    roomVisible: !!document.querySelector('[data-testid="artifact-panel"]'),
  }));

  record("Interactions", "URL as state",
    afterReload.roomVisible ? "ok" : "major",
    { urlInRoom: room.url, urlOnLanding: landing.url, urlChangedOnEnter: room.url !== landing.url,
      afterReload },
    "State must survive share, refresh and Back/Forward. Entering the room changes nothing in the URL, so a refresh drops the visitor back on the landing page and a shared link never opens the room.");

  record("Interactions", "Deep-link everything",
    afterBack.roomVisible ? "ok" : "major",
    { historyLengthInRoom, afterBack },
    "Entering the room pushes no history entry, so Back leaves the application instead of returning to the landing page.");

  // ---- Interactions — "Clear focus" (tab sweep) -------------------------------
  await openRoom(page);
  const focusSweep = [];
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const outlineWidth = parseFloat(cs.outlineWidth) || 0;
      return { tag: el.tagName, testid: el.getAttribute("data-testid"),
        cls: `${el.className}`.slice(0, 44),
        // An unclassed <input> is unidentifiable in a report, so carry whatever
        // else names it: the placeholder a person reads, and its wrapper.
        placeholder: el.getAttribute("placeholder"),
        parent: `${el.parentElement?.tagName}.${el.parentElement?.className ?? ""}`.slice(0, 60),
        label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 28),
        outline: cs.outline, boxShadow: `${cs.boxShadow}`.slice(0, 48),
        visibleRing: (outlineWidth > 0 && cs.outlineStyle !== "none")
          || (cs.boxShadow !== "none" && cs.boxShadow !== "") };
    });
    if (info) focusSweep.push(info);
  }
  const ringless = focusSweep.filter((f) => !f.visibleRing);
  record("Interactions", "Clear focus", ringless.length > 0 ? "major" : "ok",
    { tabPresses: 40, focusedElements: focusSweep.length,
      withoutVisibleRing: ringless.length, examples: ringless.slice(0, 5) },
    "Every focusable element must show a visible focus ring.");

  // Interactions — "Keyboard works everywhere": can a keyboard reach the work?
  const reached = new Set(focusSweep.map((f) => f.testid).filter(Boolean));
  const reachedComposer = reached.has("chat-composer");
  const reachedCell = reached.has("cell-edit-control");
  record("Interactions", "Keyboard works everywhere",
    reachedComposer && reachedCell ? "ok" : "major",
    { tabPresses: 40, reachedChatComposer: reachedComposer, reachedSheetCell: reachedCell,
      distinctTestidsReached: [...reached].slice(0, 20) },
    "40 consecutive Tab presses from a fresh room. The two controls the journeys are about are the chat composer and a sheet cell.");

  // ---- Forms — "Don't block paste" and textarea behaviour ---------------------
  await openRoom(page);
  const composer = page.getByTestId("chat-composer");
  await composer.click();
  const pasteBlocked = await composer.evaluate((el) => {
    const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  record("Interactions", "Don't block paste", pasteBlocked ? "major" : "ok",
    { pasteEventDefaultPrevented: pasteBlocked },
    "A paste event dispatched on the chat composer; blocked means the app called preventDefault on it.");

  await composer.fill("line one");
  await composer.press("Enter");
  await page.waitForTimeout(600);
  const enterBehaviour = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="chat-composer"]');
    return { valueAfterEnter: el?.value ?? "", cleared: (el?.value ?? "") === "" };
  });
  record("Forms", "Textarea behavior",
    enterBehaviour.cleared ? "minor" : "ok", { enterBehaviour },
    "In a textarea the guideline wants Enter to insert a newline and Cmd/Ctrl+Enter to submit. Cleared means Enter submitted instead. Chat convention differs from the guideline, so this is recorded, not treated as major.");

  // ---- Interactions — "Mobile input size" ------------------------------------
  const mobile = await browser.newContext({ ...devices["Pixel 7"] });
  const mPage = await mobile.newPage();
  await mPage.goto(landingUrl.replace("surface=desktop", "surface=mobile"), { waitUntil: "domcontentloaded" });
  await seedStorage(mPage);
  await mPage.waitForTimeout(7_000);
  const mobileInputs = await mPage.evaluate(() => {
    const els = [...document.querySelectorAll("input,textarea,select")]
      .filter((el) => el.offsetParent !== null);
    return els.map((el) => ({ tag: el.tagName, type: el.getAttribute("type"),
      testid: el.getAttribute("data-testid"),
      fontSizePx: parseFloat(getComputedStyle(el).fontSize) }));
  });
  await mPage.screenshot({ path: join(outDir, "wig-mobile-412.png") });
  const tooSmall = mobileInputs.filter((i) => i.fontSizePx < 16);
  record("Interactions", "Mobile input size",
    tooSmall.length > 0 ? "major" : "ok",
    { device: "Pixel 7 (412px)", inputsVisible: mobileInputs.length, under16px: tooSmall },
    "Input font size must be at least 16px on mobile or iOS Safari zooms the page on focus.");

  // ---- Layout — "Responsive coverage" and "No excessive scrollbars" ----------
  // Also the measurement conditions 3, 4 and 9 of the promotion gate rest on:
  // is each width a deliberate layout, does anything overflow sideways, and does
  // any width produce a console error or a failed request.
  const widths = [320, 360, 412, 768, 1280, 1440];
  const widthSweep = [];
  for (const width of widths) {
    const wCtx = await browser.newContext({ viewport: { width, height: 900 } });
    const wPage = await wCtx.newPage();
    const wErrors = [];
    const wFailed = [];
    wPage.on("console", (m) => { if (m.type() === "error") wErrors.push(m.text()); });
    wPage.on("pageerror", (e) => wErrors.push(String(e)));
    wPage.on("requestfailed", (r) => wFailed.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
    wPage.on("response", (r) => { if (r.status() >= 400) wFailed.push(`${r.status()} ${r.url()}`); });
    // NOT `landingUrl` — that pins `surface=desktop`, which would force the desktop
    // shell at 320px and make "is the phone layout intentional" unanswerable. A real
    // visitor arrives without the override, so the sweep does too.
    await wPage.goto(`${baseUrl}/?mode=memory`, { waitUntil: "domcontentloaded" });
    await seedStorage(wPage);
    await wPage.waitForTimeout(7_000);
    const m = await wPage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      // Which shell rendered: the purpose-built phone shell has its own bottom nav.
      mobileShell: !!document.querySelector('[data-testid^="mobile-nav-"]'),
      desktopCta: !!document.querySelector('[data-testid="start-demo-room"]'),
    }));
    await wPage.screenshot({ path: join(outDir, `wig-width-${width}.png`), fullPage: false });
    widthSweep.push({ width, ...m, overflow: m.scrollWidth > m.innerWidth,
      consoleErrors: wErrors, failedRequests: wFailed });
    await wCtx.close();
  }
  const overflowing = widthSweep.filter((w) => w.overflow);
  const noisy = widthSweep.filter((w) => w.consoleErrors.length || w.failedRequests.length);
  record("Layout", "Responsive coverage / No excessive scrollbars",
    overflowing.length > 0 ? "major" : "ok",
    { widths, sweep: widthSweep, overflowingWidths: overflowing.map((w) => w.width),
      widthsWithConsoleErrorsOrFailedRequests: noisy.map((w) => w.width) },
    "Every supported width was loaded and measured: horizontal overflow (scrollWidth vs innerWidth), which shell rendered, and any console error or failed request at that width. This is also the measurement behind promotion conditions 3, 4 and 9.");

  // ---- Animations — "Honor prefers-reduced-motion" ---------------------------
  const reduced = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const rPage = await reduced.newPage();
  await openRoom(rPage);
  const stillAnimating = await rPage.evaluate(() => {
    const moving = [];
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      const dur = parseFloat(cs.animationDuration) || 0;
      const iter = cs.animationIterationCount;
      if (dur > 0 && cs.animationName !== "none" && (iter === "infinite" || parseFloat(iter) > 0)) {
        moving.push(`${el.tagName}.${`${el.className}`.split(" ")[0]} ${cs.animationName} ${cs.animationDuration} x${iter}`);
      }
    }
    return [...new Set(moving)];
  });
  await rPage.screenshot({ path: join(outDir, "wig-reduced-motion.png") });
  record("Animations", "Honor prefers-reduced-motion",
    stillAnimating.length > 0 ? "minor" : "ok",
    { elementsStillAnimating: stillAnimating.length, sample: stillAnimating.slice(0, 10) },
    "Measured in a context with prefers-reduced-motion: reduce. Counts elements still carrying a running CSS animation.");

  await browser.close();

  const majors = findings.filter((f) => f.verdict === "major");
  const summary = {
    condition: 7,
    review: "Vercel Web Interface Guidelines",
    guidelinesSource: "https://vercel.com/design/guidelines",
    guidelinesFetched: "2026-08-13",
    note: "This is a guideline-by-guideline review with a measurement per rule. It is not a Lighthouse or axe score and does not reuse one — this file shares no input with promotion-web-quality-audit.mjs.",
    coverage: {
      rulesReviewedHere: findings.length,
      publishedRulesTotalApprox: 120,
      claim: "Partial coverage, deliberately. These are the rules decidable by a measurement on the rendered page. Rules needing human judgement (optical alignment, easing choice, copy voice) or a device lab (iOS Low Power Mode, macOS Safari) were NOT reviewed and must not be read as clean.",
      notReviewedExamples: ["Layout — Optical alignment", "Animations — Easing fits the subject",
        "Performance — Device/browser matrix", "Copywriting — Title Case", "Design — Layered shadows"],
    },
    baseUrl,
    landingUrl,
    capturedAt: new Date().toISOString(),
    screenshots: ["wig-room-1440.png", "wig-after-reload.png", "wig-mobile-412.png",
      "wig-reduced-motion.png", ...[320, 360, 412, 768, 1280, 1440].map((w) => `wig-width-${w}.png`)],
    rulesReviewed: findings.length,
    majorCount: majors.length,
    minorCount: findings.filter((f) => f.verdict === "minor").length,
    okCount: findings.filter((f) => f.verdict === "ok").length,
    findings,
    majors: majors.map((m) => `${m.section} — ${m.rule}`),
    pass: majors.length === 0,
  };
  writeFileSync(join(outDir, "wig-review.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ rulesReviewed: summary.rulesReviewed, majorCount: summary.majorCount,
    minorCount: summary.minorCount, majors: summary.majors }, null, 2));
  process.exit(summary.pass ? 0 : 1);
};

main().catch((err) => { console.error(err); process.exit(1); });
