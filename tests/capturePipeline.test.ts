/**
 * Scenario: an analyst points the agent at a public filing page to capture a value (e.g. "FY revenue")
 * with a screenshot + a highlight box on the exact cell. We exercise the loop's CONTRACT, not a live
 * browser, by injecting a mock ReasoningModel + a mock BrowserSubstrate.
 *
 * Angles: happy path · step bound (model never stops) · honest failure (substrate dies) · time budget ·
 * non-interactive substrate (Firecrawl: extract-only) · adversarial SSRF URL rejection.
 */
import { describe, it, expect } from "vitest";
import { runCapture } from "../src/nodeagent/capture/pipeline";
import { assertCapturableUrl, CaptureUrlError, CAPTURE_LIMITS } from "../src/nodeagent/capture/guards";
import type { BrowserSubstrate, PageHandle, ReasoningModel } from "../src/nodeagent/capture/types";
import { captureSource } from "../src/nodeagent/capture/captureSource";
import { PRODUCTION_TOOL_NAMES } from "../src/nodeagent/skills/spreadsheet/cellMutator";
import { SERVER_PRODUCTION_TOOL_NAMES } from "../src/nodeagent/skills/server/productionTools";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic — stand-in bytes

/** A substrate whose locate() knows two boxes by their source text. */
function mockSubstrate(opts: { interactive?: boolean; openThrows?: boolean; acts?: string[] } = {}): BrowserSubstrate & { acts: string[] } {
  const acts: string[] = opts.acts ?? [];
  const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {
    "$391.0B": { x: 0.2, y: 0.4, w: 0.15, h: 0.04 },
    "2023": { x: 0.1, y: 0.4, w: 0.06, h: 0.04 },
  };
  const page: PageHandle = {
    async representation() { return { url: "https://example.com/10-k", title: "FY23 10-K", a11y: "table row: Total revenue | 2023 | $391.0B" }; },
    async screenshot() { return { png: PNG, width: 1280, height: 720 }; },
    async locate(t) { const b = t.text ? boxes[t.text] : undefined; return b ? { ...t, box: b, selector: `text=${t.text}` } : null; },
    async act(a) { acts.push(`${a.kind}:${a.target?.text ?? a.target?.description ?? ""}`); return a.target?.text && boxes[a.target.text] ? { box: boxes[a.target.text] } : {}; },
    async close() { /* noop */ },
  };
  return {
    name: "mock",
    acts,
    capabilities: { interactive: opts.interactive ?? true },
    async open() { if (opts.openThrows) throw new Error("browser session failed to start"); return page; },
  };
}

/** A reasoner replaying scripted act-decisions, then a fixed extract result. */
function mockReasoner(script: { thought: string; done: boolean; action?: any }[], extract: { fields: any[] }): ReasoningModel {
  let i = 0;
  return {
    name: "mock-reasoner",
    async decide({ system }) {
      if (/extract/i.test(system)) return extract as never;
      const step = script[Math.min(i++, script.length - 1)];
      return step as never;
    },
  };
}

describe("runCapture — observe/act/extract loop", () => {
  it("happy path: clicks once, extracts fields, each step carries a screenshot + located box", async () => {
    const sub = mockSubstrate();
    const reasoner = mockReasoner(
      [
        { thought: "open the financials tab", done: false, action: { kind: "click", target: { description: "Financials tab", text: "2023" } } },
        { thought: "the revenue row is visible", done: true },
      ],
      { fields: [{ name: "FY revenue", value: "$391.0B", sourceText: "$391.0B" }] },
    );
    const res = await runCapture({ url: "https://example.com/10-k", goal: "find FY revenue", reasoner, substrate: sub });

    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ "FY revenue": "$391.0B" });
    expect(sub.acts).toEqual(["click:2023"]); // exactly one action taken
    const act = res.steps.find((s) => s.phase === "Act");
    expect(act?.screenshotPng).toBe(PNG);
    expect(act?.box).toEqual({ x: 0.1, y: 0.4, w: 0.06, h: 0.04 }); // box of the clicked element
    const extract = res.steps.find((s) => s.phase === "Extract");
    expect(extract?.box).toEqual({ x: 0.2, y: 0.4, w: 0.15, h: 0.04 }); // box of the extracted value
    expect(extract?.label).toContain("$391.0B");
  });

  it("BOUND: a model that never says done stops at MAX_STEPS (no infinite loop)", async () => {
    const sub = mockSubstrate();
    const reasoner = mockReasoner(
      [{ thought: "keep scrolling", done: false, action: { kind: "scroll" } }],
      { fields: [] },
    );
    const res = await runCapture({ url: "https://example.com/10-k", goal: "x", reasoner, substrate: sub });
    expect(res.ok).toBe(true);
    expect(sub.acts.length).toBe(CAPTURE_LIMITS.MAX_STEPS); // capped, not unbounded
  });

  it("HONEST_STATUS: a substrate that fails to open returns ok:false with an error, never a fake success", async () => {
    const sub = mockSubstrate({ openThrows: true });
    const reasoner = mockReasoner([{ thought: "", done: true }], { fields: [] });
    const res = await runCapture({ url: "https://example.com/10-k", goal: "x", reasoner, substrate: sub });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/failed to start/);
    expect(res.data).toBeUndefined();
    expect(res.steps.some((s) => s.phase === "Error" && s.status === "risk")).toBe(true);
  });

  it("TIMEOUT: an exhausted wall-clock budget ends the act loop with a warn step", async () => {
    const sub = mockSubstrate();
    const reasoner = mockReasoner([{ thought: "act", done: false, action: { kind: "scroll" } }], { fields: [] });
    let t = 1000;
    const res = await runCapture({ url: "https://example.com/10-k", goal: "x", reasoner, substrate: sub, budgetMs: 5000, now: () => (t += 4000) });
    expect(res.ok).toBe(true);
    expect(res.steps.some((s) => s.status === "warn" && /budget/.test(s.label))).toBe(true);
  });

  it("non-interactive substrate (Firecrawl-style) skips act and goes straight to extract", async () => {
    const sub = mockSubstrate({ interactive: false });
    const reasoner = mockReasoner([], { fields: [{ name: "FY revenue", value: "$391.0B", sourceText: "$391.0B" }] });
    const res = await runCapture({ url: "https://example.com/10-k", goal: "x", reasoner, substrate: sub });
    expect(res.ok).toBe(true);
    expect(sub.acts.length).toBe(0); // no actions on a non-interactive substrate
    expect(res.steps.every((s) => s.phase !== "Act")).toBe(true);
    expect(res.data).toEqual({ "FY revenue": "$391.0B" });
  });
});

describe("capture_source production registry", () => {
  it("is server-only: not in browser-safe tools, present in Convex/worker tools", () => {
    expect(PRODUCTION_TOOL_NAMES).not.toContain("capture_source");
    expect(SERVER_PRODUCTION_TOOL_NAMES).toContain("capture_source");
  });
});

describe("assertCapturableUrl — SSRF / scheme guard", () => {
  it("accepts a public https URL", () => {
    expect(assertCapturableUrl("https://www.sec.gov/cgi-bin/browse-edgar").hostname).toBe("www.sec.gov");
  });
  it("rejects private IPs, localhost, and non-http schemes", () => {
    for (const bad of ["http://127.0.0.1/", "http://10.0.0.5/", "http://169.254.169.254/latest/meta-data", "http://localhost:3000/", "file:///etc/passwd", "ftp://example.com/"]) {
      expect(() => assertCapturableUrl(bad)).toThrow(CaptureUrlError);
    }
  });
  it("enforces an allowlist when provided", () => {
    expect(() => assertCapturableUrl("https://evil.example/", { allowHosts: ["sec.gov"] })).toThrow(/allowlist/);
    expect(assertCapturableUrl("https://www.sec.gov/x", { allowHosts: ["sec.gov"] }).hostname).toBe("www.sec.gov");
  });
});

describe("captureSource — env-selected wrapper", () => {
  it("returns ok:false with remediation when NO substrate is configured (no fake success)", async () => {
    // No keys are passed and the test env has none → pickSubstrate() returns null.
    const r = await captureSource({ url: "https://www.sec.gov/x", goal: "find revenue" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/substrate/);
    expect(r.steps[0]?.detail).toMatch(/BROWSERBASE_API_KEY|FIRECRAWL_API_KEY/);
  });

  it("runs the loop when a substrate + reasoner are injected", async () => {
    const sub = mockSubstrate();
    const reasoner = mockReasoner([{ thought: "ready", done: true }], { fields: [{ name: "FY revenue", value: "$391.0B", sourceText: "$391.0B" }] });
    const r = await captureSource({ url: "https://www.sec.gov/x", goal: "find revenue", substrate: sub, reasoner });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ "FY revenue": "$391.0B" });
  });
});
