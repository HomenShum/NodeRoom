/**
 * STATE CAPTURES — the "every granular component × every state × theme/width" visual record.
 *
 * Unlike capture-previews (which animate a workflow), this drives the REAL memory-mode app to each
 * discrete UI state and screenshots it, building docs/qa/state-captures/<surface>/<state>.png plus
 * a manifest the state-set vision judge (scripts/judge-state-captures.ts) reads. Every state is
 * reached by driving a real flow — no mocked DOM — so a captured pixel is a pixel a user gets.
 *
 *   npx playwright test e2e/state-captures.spec.ts
 *   npm run qa:states            (then) npm run qa:judge-states
 */
import { test, expect } from "./fixtures";
import { enterDemoRoom, publicChat } from "./fixtures";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page, Locator } from "@playwright/test";

const OUT = "docs/qa/state-captures";
const MANIFEST = join(OUT, "manifest.json");

type Capture = { surface: string; state: string; theme: "dark" | "light"; width: number; file: string; mustBeTrue: string };
const captures: Capture[] = [];

function record(c: Capture) { captures.push(c); }
function flushManifest() {
  mkdirSync(OUT, { recursive: true });
  // Merge across test files/runs so a single-surface re-run doesn't wipe the others.
  let prior: Capture[] = [];
  if (existsSync(MANIFEST)) { try { prior = JSON.parse(readFileSync(MANIFEST, "utf8")).captures ?? []; } catch { prior = []; } }
  const merged = [...prior.filter((p) => !captures.some((c) => c.file === p.file)), ...captures];
  writeFileSync(MANIFEST, JSON.stringify({ generatedNote: "regenerate with `npm run qa:states`", captures: merged }, null, 2) + "\n");
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await page.waitForTimeout(120);
}

/** Shoot a locator (or full page) to OUT/<surface>/<state>.png and record it.
 *  For a Locator we screenshot via the PAGE clipped to its bounding box — element.screenshot()
 *  scrolls the element into view, which moves the mouse off it and DROPS any :hover state. The
 *  page-clip method preserves the mouse position so hover/active captures are faithful. */
async function shoot(target: Page | Locator, surface: string, state: string, theme: "dark" | "light", width: number, mustBeTrue: string) {
  const file = `${surface}/${state}--${theme}--${width}.png`;
  const path = join(OUT, file);
  mkdirSync(dirname(path), { recursive: true });
  if ("boundingBox" in target) {
    const loc = target as Locator;
    const box = await loc.boundingBox();
    if (box) {
      const pad = 4;
      await loc.page().screenshot({ path, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 } });
    } else {
      await loc.screenshot({ path });
    }
  } else {
    await (target as Page).screenshot({ path });
  }
  record({ surface, state, theme, width, file, mustBeTrue });
}

test.use({ viewport: { width: 1860, height: 980 } });

test("capture — Landing states", async ({ page }) => {
  await page.goto("/?mode=memory");
  await page.evaluate(() => { try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ } });
  const card = page.locator(".r-landing");
  await expect(card).toBeVisible();
  await setTheme(page, "dark");
  await shoot(card, "landing", "default", "dark", 1860, "Single filled primary CTA (Enter the room); Join is a bordered secondary, not a second filled button. Name field present.");
  await page.locator(".r-join-inline input").focus();
  await shoot(card, "landing", "join-focus", "dark", 1860, "The code input shows a visible focus ring; the Join button stays the quieter secondary.");
  await setTheme(page, "light");
  await shoot(card, "landing", "default", "light", 1860, "Same hierarchy holds in light theme; the primary CTA is the only filled button.");
  flushManifest();
});

test("capture — top bar (RoomShell) states", async ({ page }) => {
  await enterDemoRoom(page);
  const top = page.locator(".r-top");
  await setTheme(page, "dark");
  await shoot(top, "topbar", "default", "dark", 1860, "Clean bar: brand, room-code chip, presence facepile + live, one settings icon — agent-commits, focus, theme, and leave now live in settings.");
  // Micro-states are captured on the CONTROL itself, not the 1860px bar — a one-shade hover change
  // is invisible in a full-width strip (diagnosed: the CSS is correct, the framing was the problem).
  const code = page.locator(".r-roomcode");
  await shoot(code, "topbar", "roomcode-rest", "dark", 1860, "The room-code chip at rest: a real button (bordered chip) with a copy glyph.");
  await code.hover();
  await shoot(code, "topbar", "roomcode-hover", "dark", 1860, "On hover the chip background lightens and the border strengthens (two-cue hover) — it looks clickable because it IS a button.");
  await code.click();
  await page.waitForTimeout(150);
  await shoot(code, "topbar", "roomcode-copied", "dark", 1860, "After click a check-mark replaces the copy glyph — copy feedback confirming the code was copied.");
  // auto-allow on vs off, captured on the relocated control inside the settings panel
  // (the pill moved out of the resting bar for design-target parity).
  await page.getByTestId("room-settings-btn").click();
  const pill = page.getByTestId("agent-commit-policy");
  await shoot(pill, "topbar", "autoallow-on", "dark", 1860, "Auto-allow ON: accent track, knob to the RIGHT.");
  await page.getByTestId("auto-allow-switch").click();
  await page.waitForTimeout(450); // let the .18s spring settle so the knob is fully LEFT, not mid-travel
  await shoot(pill, "topbar", "autoallow-off", "dark", 1860, "Auto-allow OFF: neutral track, knob to the LEFT — clearly distinct from ON.");
  // Toggle theme via the REAL button — relocated into the settings panel (design-target parity).
  // Settings is still open from the auto-allow capture; flip theme there, then close and shoot.
  await page.getByTestId("room-tweaks").getByRole("button", { name: /theme/i }).click();
  await page.getByTestId("room-settings-btn").click(); // close settings, restore the resting bar
  await page.waitForTimeout(150);
  await shoot(top, "topbar", "default", "light", 1860, "Top bar holds contrast in light theme; the icons stay legible; no invisible icons.");
  flushManifest();
});

test("capture — LeftRail states", async ({ page }) => {
  await enterDemoRoom(page);
  await setTheme(page, "dark");
  const rail = page.getByTestId("left-rail");
  await shoot(rail, "leftrail", "default", "dark", 1860, "File rows (the OPEN artifact carries a persistent selected background - selection, not hover); the upload button; the inert 'Data room exports' source row is muted and must NOT look like the clickable artifact rows.");
  // Hover a NON-selected row (nth 0 = Agent wiki; nth 1 = Q3 variance is the OPEN/selected one).
  await page.locator(".r-file").nth(0).hover();
  await shoot(rail, "leftrail", "file-hover", "dark", 1860, "A non-selected file row (Agent wiki) shows a hover-fill - distinct from both the default rows and the accent-tinted SELECTED row (Q3 variance).");
  await page.locator(".r-file-static").filter({ hasText: /Data room exports/i }).hover();
  await shoot(rail, "leftrail", "static-hover", "dark", 1860, "The inert data-room source row does NOT highlight on hover - it stays muted. (The 'Agent wiki' row carries a persistent SELECTED background because it is the open artifact - that is selection, not hover.)");
  flushManifest();
});

test("capture — Chat states", async ({ page }) => {
  await enterDemoRoom(page);
  await setTheme(page, "dark");
  const chat = publicChat(page);
  const composer = chat.getByTestId("chat-composer");
  await shoot(chat, "chat", "composer-empty", "dark", 1860, "Empty composer with placeholder + send affordance; the send control state reflects empty input.");
  await composer.fill("@nodeagent diligence CardioNova");
  await shoot(chat, "chat", "composer-typed", "dark", 1860, "A typed slash-command; the send button now looks actionable.");
  await composer.fill("");
  await composer.focus();
  await shoot(chat, "chat", "composer-focus", "dark", 1860, "Focused EMPTY composer shows a visible focus ring (distinct from the typed state) AND a muted/disabled send button reflecting the empty input.");
  // Send a message so we can hover OUR OWN message (which has edit/promote rights), not an agent one.
  await composer.fill("Checking CardioNova product, funding, hiring, and HIPAA gaps now.");
  await composer.press("Enter");
  await page.waitForTimeout(300);
  const mine = chat.getByTestId("chat-message").last();
  if (await mine.count()) { await mine.hover(); await shoot(chat, "chat", "message-hover", "dark", 1860, "Hovering YOUR OWN message reveals its action controls (copy/edit/promote) at a legible size."); }
  flushManifest();
});

test("capture — Sheet cell + proposal states (Artifact)", async ({ page }) => {
  await enterDemoRoom(page);
  await setTheme(page, "dark");
  const panel = page.getByTestId("artifact-panel");
  await shoot(panel, "sheet", "empty-cells", "dark", 1860, "Empty variance cells show a '+ add' affordance (not 'null'); existing values use neutral/sign-aware color, not all-green.");

  // editing state: open the inline editor on an empty cell
  const addCell = panel.locator("button.r-cell-edit").filter({ hasText: "add" }).first();
  if (await addCell.count()) {
    await addCell.click();
    const input = panel.locator("input.r-cell-input");
    if (await input.count()) { await input.fill("-12.5%"); await shoot(panel, "sheet", "cell-editing", "dark", 1860, "An editing cell shows a clearly-bordered input; a negative value previews in the danger color (sign-aware)."); await input.press("Escape"); }
  }

  // review mode → proposals (locked + proposal-pending + the accept/reject controls)
  await page.getByTestId("room-settings-btn").click();
  await page.getByTestId("auto-allow-switch").click();
  await page.getByTestId("room-settings-btn").click();
  await page.evaluate(() => (window as any).__runCollab());
  const inlineProp = panel.getByTestId("proposal-inline").first();
  await expect(inlineProp).toBeVisible({ timeout: 15_000 });
  await shoot(panel, "sheet", "proposal-pending", "dark", 1860, "Agent edits arrive as inline proposals: the suggested VALUE carries the accent; the ✓ accept / ✗ reject controls are neutral ghosts of equal weight (no ban-circle, no solid-accent button).");
  await panel.getByTestId("proposal-inline-approve").first().hover();
  await shoot(panel, "sheet", "proposal-accept-hover", "dark", 1860, "Hovering ✓ accept tints green (semantic confirm), not the brand accent.");
  await panel.getByTestId("proposal-inline-reject").first().hover();
  await shoot(panel, "sheet", "proposal-reject-hover", "dark", 1860, "Hovering ✗ reject tints soft-red (semantic decline); the glyph is an X, never a ban-circle.");
  flushManifest();
});

test("capture — Research import states (Artifact)", async ({ page }) => {
  await enterDemoRoom(page);
  await setTheme(page, "dark");
  await page.locator(".r-tab", { hasText: /Research/i }).first().click();
  const panel = page.getByTestId("artifact-panel");
  await shoot(panel, "research", "default", "dark", 1860, "Research grid with pending rows; the 'Enrich N pending' and 'Import accounts' buttons are normally-sized, not slabs.");
  // open import + empty-submit error (dead-button fix)
  await panel.locator(".r-btn", { hasText: /Import accounts/i }).first().click();
  const importBtn = panel.locator(".r-btn.primary", { hasText: /Import \/ update rows/i });
  await expect(importBtn).toBeVisible();
  await shoot(panel, "research", "import-open", "dark", 1860, "The import form: the 'Import / update rows' button sits bottom-right beside the textarea at NORMAL height — it does NOT stretch to a giant orange block matching the 3-row textarea.");
  await importBtn.click(); // empty paste → inline explanation, not a dead disabled button
  await expect(panel.getByTestId("research-add-error")).toBeVisible();
  await shoot(panel, "research", "import-empty-error", "dark", 1860, "Submitting an empty paste shows an inline explanation full-width below the field (no silent dead button, no layout shift of the submit).");
  flushManifest();
});

test("capture — Excel paper + GuidedTour", async ({ page }) => {
  await enterDemoRoom(page);
  await setTheme(page, "dark");
  // Guided tour (clear the seen-flag so it auto-starts)
  await page.evaluate(() => { try { localStorage.removeItem("noderoom:tour:v1"); } catch { /* ignore */ } });
  await page.reload();
  const tour = page.getByTestId("guided-tour");
  if (await tour.count()) {
    await expect(tour).toBeVisible({ timeout: 8000 });
    await shoot(page, "tour", "step-1", "dark", 1860, "The spotlight tour: a scrim dims the app, the highlighted target is cut out, and a 'skip' affordance is visible (don't-trap-the-user).");
  }
  flushManifest();
});
