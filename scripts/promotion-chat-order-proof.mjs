/**
 * Promotion loop — defect D-1 proof producer (journey J3, the receipt journey).
 *
 * The human situation: someone opens the sample room, types a request to the
 * assistant in the chat, and expects to see their own line and the assistant's
 * answer appear at the bottom of the conversation, the way every chat works.
 * The failure this script measures is that the new lines landed ABOVE the
 * conversation that was already there, off the top of a chat that is pinned to
 * its bottom — so the person saw no reply at all, even though the assistant had
 * answered and had already changed their spreadsheet.
 *
 * The cause was the seeded demo transcript being stamped with a fixed wall-clock
 * hour (09:38 today) while a live message is stamped with the real clock, so any
 * visitor before 09:38 local time sorted below the demo. This script pins the
 * browser clock to 04:00 local so the check is the same at any hour of the day,
 * on any machine.
 *
 * Paper note: this script proves that a message you send in the sample room
 * appears at the bottom of the conversation, below everything that was already
 * there, no matter what time of day you open it.
 *
 *   node scripts/promotion-chat-order-proof.mjs \
 *     --base-url http://127.0.0.1:4305 \
 *     --out promotion/evidence/iteration-1
 *
 * Exit code 0 = ordering correct. Exit code 1 = defect present (or the run
 * could not reach the room, which is also a failure).
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const baseUrl = arg("base-url", "http://127.0.0.1:4305").replace(/\/$/, "");
const outDir = resolve(arg("out", "promotion/evidence/iteration-1"));
const label = arg("label", "after");
const prompt = "@nodeagent recompute the Q3 variance column";

/** Today at 04:00 local — deliberately before the 09:38 the demo transcript used to hard-code. */
function fixedMorning() {
  const d = new Date();
  d.setHours(4, 0, 0, 0);
  return d;
}

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  // Fake clock at 04:00 local, then resume so timers still fire at real speed:
  // the assistant's reply arrives on a setTimeout and must not be frozen.
  await page.clock.install({ time: fixedMorning() });

  await page.goto(`${baseUrl}/?mode=memory&surface=desktop`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    try {
      localStorage.setItem("noderoom:tour:v1", "done");
      localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: true, paused: false }));
    } catch { /* ignore */ }
  });
  await page.clock.resume();

  const panel = page.getByTestId("artifact-panel");
  if (!(await panel.isVisible().catch(() => false))) {
    const enter = page.getByTestId("start-demo-room");
    await enter.waitFor({ state: "visible", timeout: 45_000 });
    await enter.click();
  }
  await panel.waitFor({ state: "visible", timeout: 45_000 });

  const chat = page.getByTestId("public-chat-panel");
  await chat.getByTestId("chat-composer").fill(prompt);
  await chat.getByTestId("chat-send").click();

  // The assistant's answer is briefly a live "working" card before it settles as the
  // committed receipt, so poll the SAME nodes the readout scans rather than a separate
  // locator — the wait and the measurement can then never disagree about what was on
  // screen. Poll until the receipt row is present, up to 30s.
  const feed = chat.getByTestId("chat-feed").first();
  const scan = () => feed.evaluate((root, sent) => {
    const rows = [...root.querySelectorAll('[data-testid="chat-message"]')];
    const feedBox = root.getBoundingClientRect();
    return rows.map((row, index) => {
      const box = row.getBoundingClientRect();
      const text = (row.querySelector(".body")?.textContent ?? "").replace(/\s+/g, " ").trim();
      return {
        index,
        clientMsgId: row.getAttribute("data-clientmsgid") ?? "",
        seeded: (row.getAttribute("data-clientmsgid") ?? "").startsWith("seed-"),
        who: row.querySelector(".who")?.textContent ?? "",
        time: row.querySelector(".time")?.textContent ?? "",
        isSentPrompt: text.includes(sent),
        isAgentReceipt: text.includes("Lock released"),
        text: text.slice(0, 120),
        // "In view" = inside the chat feed's own scrollport as the user finds it.
        inView: box.bottom > feedBox.top && box.top < feedBox.bottom,
      };
    });
  }, prompt);

  let readout = [];
  let replyArrived = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    readout = await scan();
    replyArrived = readout.some((r) => !r.seeded && r.isAgentReceipt);
    if (replyArrived) break;
    await page.waitForTimeout(500);
  }

  const seeded = readout.filter((r) => r.seeded);
  const live = readout.filter((r) => !r.seeded);
  const lastSeededIndex = seeded.length ? Math.max(...seeded.map((r) => r.index)) : -1;
  const firstLiveIndex = live.length ? Math.min(...live.map((r) => r.index)) : -1;
  const sentRow = readout.find((r) => r.isSentPrompt) ?? null;
  const replyRow = readout.find((r) => !r.seeded && r.isAgentReceipt) ?? null;

  const result = {
    label,
    baseUrl,
    browserClockLocal: fixedMorning().toTimeString().slice(0, 8),
    capturedAt: new Date().toISOString(),
    prompt,
    replyArrived,
    seededCount: seeded.length,
    liveCount: live.length,
    lastSeededIndex,
    firstLiveIndex,
    sentMessageIndex: sentRow?.index ?? -1,
    sentMessageInView: sentRow?.inView ?? false,
    agentReplyIndex: replyRow?.index ?? -1,
    agentReplyInView: replyRow?.inView ?? false,
    consoleErrors,
    feed: readout,
  };
  // The ordering invariant: nothing seeded may sort after anything live.
  result.orderingCorrect = firstLiveIndex > lastSeededIndex && lastSeededIndex >= 0 && firstLiveIndex >= 0;
  result.pass = result.orderingCorrect && replyArrived && result.sentMessageInView && result.agentReplyInView;

  await page.screenshot({ path: join(outDir, `j3-chat-order-${label}.png`) });
  writeFileSync(join(outDir, `j3-chat-order-${label}.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();

  console.log(JSON.stringify({
    label, pass: result.pass, orderingCorrect: result.orderingCorrect, replyArrived,
    lastSeededIndex, firstLiveIndex,
    sentMessageIndex: result.sentMessageIndex, sentMessageInView: result.sentMessageInView,
    agentReplyIndex: result.agentReplyIndex, agentReplyInView: result.agentReplyInView,
    consoleErrors: consoleErrors.length,
  }, null, 2));
  process.exit(result.pass ? 0 : 1);
};

main().catch((err) => { console.error(err); process.exit(1); });
