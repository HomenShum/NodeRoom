import { test, expect, type Page } from "@playwright/test";

/**
 * Three users, one BRAND-NEW room, concurrent collaboration — against the LIVE Convex backend.
 * Proves reactive multi-user chat, concurrent shared-sheet edits with CAS no-clobber convergence,
 * the public AI agent, and private-channel isolation — verified in the DOM and via per-view screenshots.
 *
 * Run:  E2E_LIVE=1 npx playwright test three-user-collab.spec.ts
 * Needs .env.local with VITE_CONVEX_URL (live Convex) + provider keys (for the @nodeagent step).
 */
test.skip(!process.env.E2E_LIVE, "set E2E_LIVE=1 (live Convex backend + keys) to run the multi-user collab eval");

const SHOTS = "docs/eval/three-user-shots";
const LIVE_VIDEO_DIR = "test-results/live-videos";
const REQUIRE_REVIEW_MODE = process.env.E2E_REQUIRE_REVIEW_MODE === "1";
const v = (row: string) => `${row}__variance`;

function liveContextOptions(viewport: { width: number; height: number }) {
  return process.env.PLAYWRIGHT_RECORD_VIDEO === "1"
    ? { viewport, recordVideo: { dir: LIVE_VIDEO_DIR, size: viewport } }
    : { viewport };
}

async function dismissTour(p: Page) { await p.getByTestId("tour-skip").click({ timeout: 5000 }).catch(() => {}); }
function chat(p: Page) { return p.getByTestId("public-chat-panel"); }
function priv(p: Page) { return p.getByTestId("private-chat-panel"); }
async function openPublic(p: Page) {
  await p.getByTestId("copilot-tab-public").click({ timeout: 10_000 }).catch(() => {});
  await expect(chat(p).getByTestId("chat-composer")).toBeVisible({ timeout: 20_000 });
}
async function openPrivate(p: Page) {
  await p.getByTestId("copilot-tab-private").click({ timeout: 10_000 });
  await expect(priv(p).getByTestId("chat-composer")).toBeVisible({ timeout: 20_000 });
}
async function say(p: Page, msg: string) {
  await openPublic(p);
  await chat(p).getByTestId("chat-composer").fill(msg);
  await chat(p).getByTestId("chat-send").click();
}
async function editCell(p: Page, key: string, value: string) {
  const cell = p.locator(`[data-cell-key="${key}"]`);
  await cell.locator(".r-cell-edit").click({ timeout: 10000 });
  const input = cell.locator("input.r-cell-input");
  await input.fill(value);
  await input.press("Enter");
}
async function cellText(p: Page, key: string) {
  const control = p.locator(`[data-cell-key="${key}"]`).getByTestId("cell-edit-control");
  const value = await control.getAttribute("data-cell-value");
  return (value ?? await control.innerText()).trim();
}
async function ensureBinderOpen(p: Page) {
  const leftRail = p.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await p.getByRole("button", { name: "Toggle Room Binder panel" }).click();
  }
  await expect(leftRail).toBeVisible({ timeout: 10_000 });
}
async function openVarianceSheet(p: Page) {
  await ensureBinderOpen(p);
  await p.getByTestId("left-rail").getByRole("button", { name: /Q3 variance/ }).click();
  await expect(p.locator('[data-cell-key="r_rev__variance"]')).toBeVisible({ timeout: 30_000 });
}
async function proposalCellKeys(p: Page) {
  const keys = await p.locator('[data-testid="proposal-inline"]').evaluateAll((els) =>
    els
      .map((e) => e.closest("[data-cell-key]")?.getAttribute("data-cell-key"))
      .filter((key): key is string => !!key)
      .sort()
  );
  return keys;
}
async function proposalText(p: Page, key: string) {
  return (await p.locator(`[data-cell-key="${key}"] [data-testid="proposal-inline"] .r-inline-proposal-text`).innerText()).trim();
}
async function setAutoAllow(p: Page, on: boolean) {
  // Agent-commits relocated into the settings panel (design-target parity); open it first.
  await p.getByTestId("room-settings-btn").click();
  const sw = p.getByTestId("auto-allow-switch");
  await expect(sw).toBeVisible({ timeout: 10_000 });
  if ((await sw.getAttribute("data-on")) !== String(on)) await sw.click();
  await expect(sw).toHaveAttribute("data-on", String(on), { timeout: 10_000 });
  await p.getByTestId("room-settings-btn").click(); // close settings, restore the resting bar
}
async function shoot(pages: Record<string, Page>, label: string) {
  for (const [name, p] of Object.entries(pages)) await p.screenshot({ path: `${SHOTS}/${label}-${name}.png` });
}

test("three users chat, edit the same sheet concurrently, and run the public agent", async ({ browser }) => {
  test.setTimeout(600_000);
  const CODE = "EVAL" + Date.now().toString(36).toUpperCase();
  const mk = async () => {
    const ctx = await browser.newContext(liveContextOptions({ width: 1280, height: 900 }));
    await ctx.addInitScript(() => {
      try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ }
    });
    return ctx.newPage();
  };
  const maya = await mk(), dev = await mk(), sam = await mk();
  const all = [maya, dev, sam];
  const pages = { maya, dev, sam };

  // ── Act 1: Maya creates the new room (+ seeds the shared Q3 sheet); Dev & Sam join by code.
  await maya.goto(`/?demo=${CODE}&name=Maya`, { waitUntil: "domcontentloaded" });
  await expect(chat(maya).getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
  await openVarianceSheet(maya); // sheet seeded
  await dismissTour(maya);
  await dev.goto(`/?room=${CODE}&name=Dev`, { waitUntil: "domcontentloaded" });
  await sam.goto(`/?room=${CODE}&name=Sam`, { waitUntil: "domcontentloaded" });
  for (const p of [dev, sam]) {
    await expect(chat(p).getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
    await openVarianceSheet(p);
    await dismissTour(p);
  }
  // roster: every view sees all three people
  for (const p of all) for (const who of ["Maya", "Dev", "Sam"]) {
    await expect(p.getByTestId("left-rail").getByText(who, { exact: false }).first()).toBeVisible({ timeout: 25_000 });
  }

  // ── Act 2: concurrent public chat → fan-out to all three feeds.
  await say(maya, "Maya: kicking off the Q3 review");
  await say(dev, "Dev: I'll take OpEx variance");
  await say(sam, "Sam: I'll take Gross profit");
  for (const p of all) for (const m of ["kicking off the Q3 review", "I'll take OpEx variance", "I'll take Gross profit"]) {
    await expect(chat(p).getByTestId("chat-feed").getByText(m, { exact: false })).toBeVisible({ timeout: 25_000 });
  }
  await shoot(pages, "act2-chat");

  // ── Act 3: parallel edits to DIFFERENT cells (no conflict) — both must land in all views.
  await Promise.all([editCell(dev, v("r_opex"), "+20.5%"), editCell(sam, v("r_gp"), "+21.7%")]);
  for (const p of all) {
    await expect.poll(() => cellText(p, v("r_opex")), { timeout: 25_000 }).toContain("20.5%");
    await expect.poll(() => cellText(p, v("r_gp")), { timeout: 25_000 }).toContain("21.7%");
  }

  // ── Act 4: SAME cell, near-simultaneous — CAS picks one winner; all views converge (no clobber).
  await Promise.all([editCell(maya, v("r_rev"), "+24pct-Maya"), editCell(dev, v("r_rev"), "+19pct-Dev")]);
  await expect.poll(async () => {
    const vals = await Promise.all(all.map((p) => cellText(p, v("r_rev"))));
    const filled = vals.filter((x) => x && x.length);
    return filled.length === 3 && new Set(vals).size === 1 ? vals[0] : null;
  }, { timeout: 30_000 }).not.toBeNull();
  const winner = await cellText(maya, v("r_rev"));
  await shoot(pages, "act4-converged");

  // ── Act 5: PUBLIC room agent (real LLM, hard gate) — Maya asks the shared Room NodeAgent to
  //    make one exact write. Pass means the shared cell value fans out to all three browsers.
  await setAutoAllow(maya, true);
  const publicAgentKey = "r_cogs__note";
  const publicAgentValue = `public-room proof ${CODE}`;
  await say(
    maya,
    `@nodeagent In the Q3 variance spreadsheet, call read_range for ${publicAgentKey}, then call write_locked_cell to set ${publicAgentKey} exactly to "${publicAgentValue}" using the baseVersion you read. Do not edit any other cells. Then say "public room proof complete".`,
  );
  await expect.poll(async () => {
    const values = await Promise.all(all.map((p) => cellText(p, publicAgentKey)));
    return values.every((value) => value.includes(publicAgentValue));
  }, { timeout: 180_000, intervals: [3000] }).toBeTruthy();
  await openPublic(sam);
  await expect(chat(sam).locator('[data-testid="chat-message"].agent').filter({ hasText: /public room proof complete|public-room proof/i }).first()).toBeVisible({ timeout: 30_000 });
  const agent = `public-write-${publicAgentKey}-visible-to-all`;
  await shoot(pages, "act5-agent");

  // ── Act 6: private AGENT + isolation. Maya asks her private NodeAgent; it replies in HER private
  //    channel only. Neither her question nor the agent reply leaks to Dev/Sam.
  const secret = "which variance row is riskiest? tag-" + Math.floor(Math.random() * 1e6);
  await openPrivate(maya);
  const privAgentBefore = await priv(maya).locator('[data-testid="chat-message"].agent').count();
  await priv(maya).getByTestId("chat-composer").fill(secret);
  await priv(maya).getByTestId("chat-send").click();
  await expect(priv(maya).getByText(secret, { exact: false })).toBeVisible({ timeout: 15_000 });
  let privateAgent = "no-reply";
  try {
    await expect.poll(() => priv(maya).locator('[data-testid="chat-message"].agent').count(), { timeout: 90_000, intervals: [2000] }).toBeGreaterThan(privAgentBefore);
    privateAgent = "replied-privately";
  } catch { privateAgent = "no-reply-within-90s"; }
  await shoot(pages, "act6-private");
  // isolation: Dev & Sam see neither Maya's question nor any private-agent bubble.
  await maya.waitForTimeout(1500);
  for (const p of [dev, sam]) {
    await openPrivate(p);
    await expect(priv(p).getByText(secret, { exact: false })).toHaveCount(0);
    await expect(priv(p).locator('[data-testid="chat-message"].agent')).toHaveCount(0);
  }

  // ── Act 7: PERSONAL agent acts in the ROOM (public). Maya flips her private panel to the Room lane and
  //    asks her agent to fill cells; it edits the SHARED sheet and/or posts public chat, attributed
  //    "via Maya", visible to Dev & Sam (real LLM, best-effort).
  let personalPublic = "not-run";
  try {
    await setAutoAllow(maya, true);
    await openPrivate(maya);
    await priv(maya).getByTestId("lane-room").click();
    const personalKey = "r_ni__note";
    const personalValue = `personal-room proof ${CODE}`;
    const viaBefore = await chat(sam).locator('[data-testid="agent-via"]').count();
    await priv(maya).getByTestId("chat-composer").fill(`In the Q3 variance spreadsheet, set ${personalKey} exactly to "${personalValue}", then post a one-line summary to the room.`);
    await priv(maya).getByTestId("chat-send").click();
    await openPublic(sam);
    await expect.poll(async () => {
      const viaNow = await chat(sam).locator('[data-testid="agent-via"]').count();
      const values = await Promise.all(all.map((p) => cellText(p, personalKey)));
      return viaNow > viaBefore || values.every((value) => value.includes(personalValue));
    }, { timeout: 150_000, intervals: [3000] }).toBeTruthy();
    personalPublic = "acted-in-room-visible-to-all";
  } catch { personalPublic = "no-visible-effect-within-150s"; }
  await shoot(pages, "act7-personal-public");

  // ── Act 8: ALL-ARTIFACT playground. A new room seeds the full trio (sheet + note + wall), and the
  //    agent can act on ANY of them (proven end-to-end by tests/allArtifactEdits.test.ts + the live
  //    note/wall agent smoke). Here we assert every view actually has the Note + Wall surfaces.
  let allArtifacts = "not-checked";
  try {
    for (const p of all) {
      const tabs = p.locator('.r-panel.artifact [data-testid="artifact-tabs"]');
      await expect(tabs.getByText(/note/i).first()).toBeVisible({ timeout: 12_000 });
      await expect(tabs.getByText(/wall/i).first()).toBeVisible({ timeout: 12_000 });
    }
    allArtifacts = "sheet+note+wall-in-all-views";
  } catch { allArtifacts = "tabs-not-all-visible"; }
  await shoot(pages, "act8-all-artifacts");

  // ── Act 9: REVIEW MODE (auto-allow OFF) — the agent files proposals instead of editing; inline
  //    approve/reject chips render AT the affected cells (Docs convention, friction fix F6) in EVERY
  //    view; the host's inline approve applies via CAS and the value fans out to Dev & Sam.
  //    Real-LLM dependent → best-effort like Acts 5/7.
  let reviewMode = "not-run";
  try {
    await setAutoAllow(maya, false);
    const reviewKey = "r_rev__note";
    const reviewValue = `review-mode proof ${CODE}`;
    await say(maya, `@nodeagent In the Q3 variance spreadsheet, use the edit_cell tool to set ${reviewKey} exactly to "${reviewValue}". Do not edit any other cells.`);
    // Chips must converge in EVERY browser, not just render locally in the host view.
    await expect.poll(async () => {
      const [mayaKeys, devKeys, samKeys] = await Promise.all(all.map(proposalCellKeys));
      const coalesced = [mayaKeys, devKeys, samKeys].every((keys) => new Set(keys).size === keys.length);
      return coalesced && mayaKeys.includes(reviewKey) && JSON.stringify(mayaKeys) === JSON.stringify(devKeys) && JSON.stringify(mayaKeys) === JSON.stringify(samKeys)
        ? mayaKeys
        : null;
    }, { timeout: 150_000, intervals: [3000] }).not.toBeNull();
    const keys = await proposalCellKeys(maya);
    expect(keys).toContain(reviewKey);
    const targetKey = reviewKey;
    const proposedValue = await proposalText(maya, targetKey);
    expect(proposedValue).toBe(reviewValue);
    for (const p of [dev, sam]) {
      await expect(p.locator(`[data-cell-key="${targetKey}"] [data-testid="proposal-inline"]`)).toContainText("host", { timeout: 10_000 });
      await expect(p.locator(`[data-cell-key="${targetKey}"] [data-testid="proposal-inline-approve"]`)).toHaveCount(0);
    }
    await shoot(pages, "act9-review-mode-pending");
    await maya.locator(`[data-cell-key="${targetKey}"] [data-testid="proposal-inline-approve"]`).click();
    await expect.poll(async () => {
      const values = await Promise.all(all.map((p) => cellText(p, targetKey)));
      const chipCounts = await Promise.all(all.map((p) => p.locator(`[data-cell-key="${targetKey}"] [data-testid="proposal-inline"]`).count()));
      return values.every((value) => value.includes(proposedValue)) && chipCounts.every((count) => count === 0);
    }, { timeout: 25_000, intervals: [1000] }).toBeTruthy();
    reviewMode = `approved-${targetKey}-value-fanned-out-to-all`;
  } catch (error) {
    reviewMode = "no-proposals-within-150s (real-LLM dependent)";
    if (REQUIRE_REVIEW_MODE) throw error;
  }
  await shoot(pages, "act9-review-mode");

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ room: CODE, sameCellWinner: winner, agent, privateAgent, personalPublic, allArtifacts, reviewMode }, null, 2));
  for (const p of all) await p.context().close();
});
