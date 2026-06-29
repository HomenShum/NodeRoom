/**
 * Browserbase substrate — a real cloud Chrome we drive with Playwright over CDP. Fully interactive:
 * observe/act/extract all work, and locate() returns the element's EXACT box (boundingBox normalized
 * by the viewport), which becomes the Trace highlight overlay. This is the "screenshot the SEC page +
 * box exactly where it clicked" path. Reads BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID.
 *
 * Runs in Node (off-Convex): playwright-core needs a Node host, so drive this from a worker / the
 * scripts/qa-trace producer, not from inside a Convex function. Convex orchestrates + persists.
 */
import { chromium, type Browser, type Page } from "playwright-core";
import type { ActStep, BrowserSubstrate, LocatedTarget, ObserveTarget, PageHandle } from "../types";
import { CAPTURE_LIMITS } from "../guards";

async function createSession(apiKey: string, projectId: string, signal: AbortSignal): Promise<string> {
  const res = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-bb-api-key": apiKey },
    body: JSON.stringify({ projectId }),
    signal,
  });
  if (!res.ok) throw new Error(`browserbase session http ${res.status}`);
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("browserbase session returned no id");
  return json.id;
}

function locatorFor(page: Page, target: ObserveTarget) {
  if (target.selectorHint) return page.locator(target.selectorHint).first();
  if (target.text) return page.getByText(target.text, { exact: false }).first();
  if (target.role) return page.getByRole(target.role as Parameters<Page["getByRole"]>[0]).first();
  return page.locator("body").first();
}

export function browserbaseSubstrate(opts: { apiKey?: string; projectId?: string } = {}): BrowserSubstrate {
  const apiKey = (opts.apiKey ?? process.env.BROWSERBASE_API_KEY)?.trim(); // trim stray \r from env
  const projectId = (opts.projectId ?? process.env.BROWSERBASE_PROJECT_ID)?.trim();
  return {
    name: "browserbase",
    capabilities: { interactive: true },
    async open(url, signal) {
      if (!apiKey || !projectId) throw new Error("BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID not set");
      const sessionId = await createSession(apiKey, projectId, signal);
      const browser: Browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${sessionId}`);
      const context = browser.contexts()[0] ?? (await browser.newContext());
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(url, { waitUntil: "domcontentloaded" });

      const vp = () => page.viewportSize() ?? { width: 1280, height: 720 };
      const handle: PageHandle = {
        async representation() {
          const a11y = await page.evaluate((max) => (document.body?.innerText ?? "").slice(0, max), CAPTURE_LIMITS.MAX_A11Y_CHARS);
          return { url: page.url(), title: await page.title(), a11y };
        },
        async screenshot() {
          const buf = await page.screenshot();
          const { width, height } = vp();
          return { png: new Uint8Array(buf), width, height };
        },
        async locate(target: ObserveTarget): Promise<LocatedTarget | null> {
          const loc = locatorFor(page, target);
          const box = await loc.boundingBox().catch(() => null);
          if (!box) return null;
          const { width, height } = vp();
          return { ...target, selector: target.selectorHint ?? target.text ?? target.role ?? "body", box: { x: box.x / width, y: box.y / height, w: box.width / width, h: box.height / height } };
        },
        async act(action: ActStep) {
          const loc = action.target ? locatorFor(page, action.target) : null;
          if (loc) await loc.scrollIntoViewIfNeeded().catch(() => { /* best-effort */ });
          const box = loc ? await loc.boundingBox().catch(() => null) : null;
          const { width, height } = vp();
          switch (action.kind) {
            case "click": if (loc) await loc.click(); break;
            case "type": if (loc && action.value !== undefined) await loc.fill(action.value); break;
            case "press": if (action.value) await page.keyboard.press(action.value); break;
            case "scroll": await page.mouse.wheel(0, 800); break;
          }
          return box ? { box: { x: box.x / width, y: box.y / height, w: box.width / width, h: box.height / height } } : {};
        },
        async close() { await browser.close().catch(() => { /* best-effort */ }); },
      };
      return handle;
    },
  };
}
