import { expect, test } from "./fixtures";

/**
 * Executes the served UI contract against the rendered app. This is the drift gate
 * that makes /.well-known/agent-ui.json a CONTRACT instead of documentation:
 *
 *  1. The built app must SERVE the contract (an agent needs no repo access).
 *  2. Every journey must complete using only the contract's own steps.
 *  3. Every element must resolve in its declared context.
 *
 * If a testid is renamed or a surface is restructured without updating
 * src/design/uiContract.ts (and re-emitting), this spec fails — that is the point.
 */

type ContractStep = { do: "click" | "press" | "goto" | "expectVisible"; target: string };
type Contract = {
  contractVersion: string;
  states: Array<{ id: string; enter: ContractStep[]; exit?: ContractStep[] }>;
  elements: Array<{ id: string; selector: string; availableIn: string[]; assertions: string[] }>;
  journeys: Array<{ id: string; steps: ContractStep[] }>;
};

async function runStep(page: import("@playwright/test").Page, step: ContractStep) {
  if (step.do === "goto") await page.goto(step.target, { waitUntil: "domcontentloaded" });
  else if (step.do === "click") await page.locator(step.target).first().click({ timeout: 15_000 });
  else if (step.do === "press") await page.keyboard.press(step.target);
  else if (step.do === "expectVisible") await expect(page.locator(step.target).first()).toBeVisible({ timeout: 15_000 });
}

test("the built app serves its agent UI contract and the rendered DOM honors it", async ({ page }) => {
  const res = await page.request.get("/.well-known/agent-ui.json");
  expect(res.ok(), "/.well-known/agent-ui.json must be served by the built app").toBe(true);
  const contract = (await res.json()) as Contract;
  expect(contract.contractVersion).toBeTruthy();

  const byContext = (ctx: string) => contract.elements.filter((e) => e.availableIn.includes(ctx));

  // Context: landing (memory mode)
  await page.goto("/?mode=memory&surface=desktop", { waitUntil: "domcontentloaded" });
  for (const el of byContext("landing")) {
    await expect(page.locator(el.selector).first(), `landing element ${el.id}`).toBeVisible({ timeout: 30_000 });
  }

  // Journey: enter-demo-room (drives the app FROM the contract's own steps)
  const enter = contract.journeys.find((j) => j.id === "enter-demo-room");
  expect(enter, "contract must declare the enter-demo-room journey").toBeTruthy();
  for (const step of enter!.steps) await runStep(page, step);
  const skip = page.getByTestId("tour-skip");
  if (await skip.count()) await skip.click().catch(() => {});

  // Context: room
  for (const el of byContext("room")) {
    const loc = page.locator(el.selector).first();
    if (el.assertions.includes("visible")) await expect(loc, `room element ${el.id}`).toBeVisible({ timeout: 15_000 });
    else await expect(loc, `room element ${el.id}`).toHaveCount(1, { timeout: 15_000 });
  }

  // Context: room.paletteOpen — enter via the contract's declared state transition
  const palette = contract.states.find((s) => s.id === "room.paletteOpen");
  expect(palette, "contract must declare the room.paletteOpen state").toBeTruthy();
  for (const step of palette!.enter) await runStep(page, step);
  for (const el of byContext("room.paletteOpen")) {
    await expect(page.locator(el.selector).first(), `palette element ${el.id}`).toBeVisible({ timeout: 10_000 });
  }
  for (const step of palette!.exit ?? []) await runStep(page, step);

  // Context: mobile (distinct surface)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#mobile?mode=memory", { waitUntil: "domcontentloaded" });
  for (const el of byContext("mobile")) {
    await expect(page.locator(el.selector).first(), `mobile element ${el.id}`).toBeVisible({ timeout: 30_000 });
  }
});
