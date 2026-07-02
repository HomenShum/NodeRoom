/**
 * Proofloop Cockpit -- an always-on overlay injected into the right side of the browser
 * while a live-prod benchmark runs, so a human can watch gates/signals pass or fail in
 * real time next to the real app UI.
 *
 * This does not fabricate numbers: NodeRoom's job-detail UI (src/ui/Chat.tsx) does not
 * currently render a dollar cost, so the cockpit's "signals" panel tracks the counters
 * that ARE visible (model calls, tool calls, mutations, attempts) and labels cost as
 * "not exposed in UI" rather than inventing a number.
 *
 * Usage (inside a Playwright spec):
 *   import { installCockpit, emitCockpitEvent, cockpitEventsPath } from "./cockpit/playwrightOverlay";
 *   const eventsPath = cockpitEventsPath(runId);
 *   await installCockpit(page, { suite: "live-browser", baseUrl: BASE });
 *   await emitCockpitEvent(page, { type: "gate_pass", gate: "fresh_room_join" }, eventsPath);
 */
import type { Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type CockpitEventType =
  | "run_start"
  | "run_done"
  | "gate_pass"
  | "gate_fail"
  | "agent_status"
  | "signal"
  | "warning"
  | "error";

export type CockpitEvent = {
  ts?: string;
  type: CockpitEventType;
  gate?: string;
  message?: string;
  metadata?: Record<string, unknown>;
};

export type CockpitOptions = {
  suite: string;
  baseUrl: string;
};

export function cockpitEventsPath(runId: string): string {
  return join(resolve(process.cwd(), ".proofloop", "runs", runId), "events.jsonl");
}

export async function installCockpit(page: Page, options: CockpitOptions): Promise<void> {
  await page.addStyleTag({ content: COCKPIT_CSS });
  await page.evaluate((opts) => {
    const w = window as unknown as { __proofloopCockpit?: unknown };
    if (w.__proofloopCockpit) return;

    const root = document.createElement("div");
    root.id = "proofloop-cockpit";
    root.innerHTML = `
      <div class="pl-cockpit-head">
        <span class="pl-cockpit-dot"></span>
        <b>Proofloop</b>&nbsp;&middot;&nbsp;${opts.suite}
      </div>
      <div class="pl-cockpit-sub">${opts.baseUrl}</div>
      <div class="pl-cockpit-section-title">Gates</div>
      <div class="pl-cockpit-gates" id="pl-cockpit-gates"></div>
      <div class="pl-cockpit-section-title">Signals <span class="pl-cockpit-hint">(cost not exposed in UI)</span></div>
      <div class="pl-cockpit-signals" id="pl-cockpit-signals"></div>
    `;
    document.body.appendChild(root);

    const gatesEl = root.querySelector("#pl-cockpit-gates") as HTMLElement;
    const signalsEl = root.querySelector("#pl-cockpit-signals") as HTMLElement;
    const gateRows = new Map<string, HTMLElement>();

    const push = (event: { ts?: string; type: string; gate?: string; message?: string; metadata?: Record<string, unknown> }) => {
      if (event.type === "gate_pass" || event.type === "gate_fail") {
        const key = event.gate ?? event.message ?? "gate";
        let row = gateRows.get(key);
        if (!row) {
          row = document.createElement("div");
          row.className = "pl-cockpit-gate";
          gatesEl.appendChild(row);
          gateRows.set(key, row);
        }
        row.dataset.status = event.type === "gate_pass" ? "pass" : "fail";
        row.textContent = `${event.type === "gate_pass" ? "\u2713" : "\u2717"} ${key}`;
        return;
      }
      const line = document.createElement("div");
      line.className = `pl-cockpit-signal pl-cockpit-signal--${event.type}`;
      const time = (event.ts ?? new Date().toISOString()).slice(11, 19);
      line.textContent = `${time} ${event.message ?? event.type}`;
      signalsEl.insertBefore(line, signalsEl.firstChild);
      while (signalsEl.childNodes.length > 24) signalsEl.removeChild(signalsEl.lastChild as ChildNode);
    };

    w.__proofloopCockpit = { push };
  }, options);
}

export async function emitCockpitEvent(page: Page, event: CockpitEvent, eventsPath?: string): Promise<void> {
  const full: CockpitEvent = { ts: new Date().toISOString(), ...event };
  if (eventsPath) {
    mkdirSync(dirname(eventsPath), { recursive: true });
    appendFileSync(eventsPath, `${JSON.stringify(full)}\n`, "utf8");
  }
  await page
    .evaluate((ev) => {
      const w = window as unknown as { __proofloopCockpit?: { push: (e: unknown) => void } };
      w.__proofloopCockpit?.push(ev);
    }, full)
    .catch(() => {
      // page may be mid-navigation; the jsonl sink already has the event.
    });
}

const COCKPIT_CSS = `
#proofloop-cockpit {
  position: fixed;
  top: 12px;
  right: 12px;
  width: 300px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  background: rgba(15, 17, 21, 0.92);
  color: #e6e8eb;
  font: 11px/1.4 "SF Mono", ui-monospace, Menlo, monospace;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px;
  padding: 10px 12px;
  z-index: 2147483647;
  pointer-events: none;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.pl-cockpit-head { font-size: 12px; display: flex; align-items: center; gap: 6px; }
.pl-cockpit-dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; display: inline-block; }
.pl-cockpit-sub { opacity: 0.6; margin: 2px 0 8px; word-break: break-all; }
.pl-cockpit-section-title { text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.55; margin: 8px 0 4px; font-size: 10px; }
.pl-cockpit-hint { text-transform: none; opacity: 0.5; font-size: 9px; }
.pl-cockpit-gate { padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
.pl-cockpit-gate[data-status="pass"] { color: #34d399; }
.pl-cockpit-gate[data-status="fail"] { color: #f87171; }
.pl-cockpit-signal { padding: 2px 0; opacity: 0.85; white-space: pre-wrap; }
.pl-cockpit-signal--warning { color: #fbbf24; }
.pl-cockpit-signal--error { color: #f87171; }
.pl-cockpit-signal--agent_status { color: #60a5fa; }
.pl-cockpit-signal--run_start, .pl-cockpit-signal--run_done { color: #34d399; }
`;
