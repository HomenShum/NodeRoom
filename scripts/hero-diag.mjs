// Temp diagnostic: why isn't the React app replacing the SSR shell?
import { chromium } from "@playwright/test";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("[console]", m.type(), m.text().slice(0, 300)); });
p.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
await p.goto("http://localhost:5261/", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
for (const sel of ["[data-testid=landing-demo-loop]", ".r-landing", ".nr-ssr", "#root", "[data-testid=story-lab]"]) {
  const n = await p.locator(sel).count();
  console.log(sel, "count:", n);
}
console.log("root inner len:", (await p.locator("#root").innerHTML().catch(() => "")).length);
await b.close();
