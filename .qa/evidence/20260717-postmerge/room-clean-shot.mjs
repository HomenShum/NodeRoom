import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 860 }, deviceScaleFactor: 2 });
await p.goto("http://127.0.0.1:5260/?mode=memory&surface=desktop", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1000);
// Simulate a RETURNING user: tour already seen -> the steady-state clean room.
await p.evaluate(() => localStorage.setItem("noderoom:tour:v1", "done"));
const s = p.getByTestId("start-demo-room");
if (await s.count()) { await s.first().click(); await p.waitForTimeout(1800); }
await p.screenshot({ path: ".qa/evidence/20260717-postmerge/before-after/after-room-steadystate.png" });
await b.close(); console.log("steady-state room captured");
