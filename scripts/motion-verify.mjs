// Temp verification (demo/motion-landing): drills still work through motion wrappers,
// reduced-motion degrades to opacity-only, memory-mode Landing renders + animates.
import { chromium } from "@playwright/test";

const b = await chromium.launch();
const out = [];
const log = (k, v) => { out.push([k, v]); console.log(k, "=>", v); };

// 1) Memory-mode React Landing (src/ui/Landing.tsx)
{
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto("http://localhost:5261/?mode=memory", { waitUntil: "load" });
  await p.waitForSelector(".r-landing", { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1200);
  log("landing .r-landing", await p.locator(".r-landing").count());
  log("landing demo-loop", await p.locator("[data-testid=landing-demo-loop]").count());
  const h1 = p.locator(".r-h1");
  log("h1 opacity", await h1.evaluate((el) => getComputedStyle(el).opacity));
  log("h1 transform", await h1.evaluate((el) => getComputedStyle(el).transform));
  await p.screenshot({ path: "after-memory-landing.png" });
  await p.close();
}

// 2) #story drills through motion wrappers
{
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto("http://localhost:5261/#story", { waitUntil: "load" });
  await p.waitForSelector("[data-testid=story-lab]", { timeout: 30000 });
  await p.waitForTimeout(800);
  // L5 no-clobber
  await p.getByText("▶ Let the AI try to overwrite my edit").click();
  await p.waitForTimeout(900);
  log("conflict box", await p.locator(".sl-conflict").count());
  log("conflict has reason:'conflict'", (await p.locator(".sl-conflict").innerText()).includes("reason:'conflict'"));
  // L4+7 lease
  await p.locator("[data-testid=story-lab-lease-run]").scrollIntoViewIfNeeded();
  await p.locator("[data-testid=story-lab-lease-run]").click();
  await p.waitForTimeout(1200);
  const leaseSteps = await p.locator("[data-testid=story-lab-lease-steps] li").count();
  log("lease steps", leaseSteps);
  log("lease has reason:'locked'", (await p.locator("[data-testid=story-lab-lease-steps]").innerText()).includes("reason:'locked'"));
  await p.screenshot({ path: "after-lease-drill.png" });
  // L6 rebase
  await p.locator("[data-testid=story-lab-rebase-run]").scrollIntoViewIfNeeded();
  await p.locator("[data-testid=story-lab-rebase-run]").click();
  await p.waitForTimeout(1200);
  log("rebase steps", await p.locator("[data-testid=story-lab-rebase-steps] li").count());
  log("rebase proposal chip", await p.locator("[data-testid=story-lab-rebase-proposal]").count());
  await p.locator("[data-testid=story-lab-rebase-approve]").click();
  await p.waitForTimeout(900);
  log("rebase approved box", await p.locator("[data-testid=story-lab-rebase-approved]").count());
  await p.screenshot({ path: "after-rebase-drill.png" });
  await p.close();
}

// 3) Reduced motion: hero must be fully visible, transform-free
{
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await p.goto("http://localhost:5261/#story", { waitUntil: "load" });
  await p.waitForSelector(".rs-hero-h1", { timeout: 30000 });
  await p.waitForTimeout(1500);
  const h1 = p.locator(".rs-hero-h1");
  log("RM h1 opacity", await h1.evaluate((el) => getComputedStyle(el).opacity));
  log("RM h1 transform", await h1.evaluate((el) => getComputedStyle(el).transform));
  const legend = p.locator(".rs-legend");
  log("RM legend opacity", await legend.evaluate((el) => getComputedStyle(el).opacity));
  await p.screenshot({ path: "after-reduced-motion-story.png" });
  await p.close();
}

await b.close();
const fails = out.filter(([k, v]) => v === 0 || v === false || v === "0");
console.log(fails.length ? "FAIL: " + JSON.stringify(fails) : "ALL CHECKS PASS");
