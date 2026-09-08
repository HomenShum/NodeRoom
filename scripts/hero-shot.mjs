// Temp verification helper (demo/motion-landing): screenshot the React landing
// (#rooms/… memory-mode Landing) and the #story surfaces, each in a FRESH page
// so boot.ts route detection runs (hash-only goto does not reload).
import { chromium } from "@playwright/test";

const prefix = process.argv[2] ?? "hero";
const b = await chromium.launch();

async function shot(url, out, extra) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => console.log("[pageerror]", out, String(e).slice(0, 300)));
  await p.goto(url, { waitUntil: "load" });
  await p.waitForTimeout(3500);
  if (extra) await extra(p);
  await p.screenshot({ path: out });
  console.log("saved", out);
  await p.close();
}

// The React Landing renders when no session exists on an app route; #story is a private route.
await shot("http://localhost:5261/#story", `${prefix}-story.png`, async (p) => {
  console.log("rs-hero count:", await p.locator(".rs-hero").count());
});
await shot("http://localhost:5261/#story", `${prefix}-storylab.png`, async (p) => {
  await p.locator("[data-testid=story-lab]").scrollIntoViewIfNeeded().catch(() => {});
  await p.waitForTimeout(1200);
  console.log("story-lab count:", await p.locator("[data-testid=story-lab]").count());
});
await b.close();
