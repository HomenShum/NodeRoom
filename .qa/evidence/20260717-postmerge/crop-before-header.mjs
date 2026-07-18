import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 760, height: 2300 } });
await p.goto("file:///D:/VSCode%20Projects/cafecorner_nodebench/nodebench_ai4/noderoom/.qa/evidence/20260717-postmerge/prod-landing-mobile.png");
await p.evaluate(() => { document.body.style.margin = "0"; const img = document.querySelector("img"); if (img) { img.style.display = "block"; img.style.width = "auto"; } });
await p.waitForTimeout(300);
await p.screenshot({ path: ".qa/evidence/20260717-postmerge/before-after/before-ssr-mobile-header.png", clip: { x: 0, y: 0, width: 750, height: 300 } });
await b.close(); console.log("cropped");
