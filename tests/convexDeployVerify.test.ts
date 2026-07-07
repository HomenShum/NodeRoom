/**
 * Scenario: a developer just ran `npx convex deploy` and needs to know
 * whether the shared prod target actually received it, or whether a
 * concurrent deploy from someone else's tree silently clobbered it (the real
 * incident this guard exists to catch — see scripts/convex-deploy-verify.ts).
 */
import { describe, expect, it } from "vitest";
import { diffDeployState, expectedIdentifiersFromSource } from "../src/eval/convexDeployVerify";

describe("expectedIdentifiersFromSource", () => {
  it("finds exported query/mutation/action (public + internal) as module.js:name identifiers", () => {
    const source = `
      export const listForArtifact = query({ args: {}, handler: async () => {} });
      export const heartbeatForAgent = internalMutation({ args: {}, handler: async () => {} });
      export const releaseForAgent = internalMutation({ args: {}, handler: async () => {} });
      export const runOne = internalAction({ args: {}, handler: async () => {} });
    `;
    expect(expectedIdentifiersFromSource(source, "presence")).toEqual([
      "presence.js:listForArtifact",
      "presence.js:heartbeatForAgent",
      "presence.js:releaseForAgent",
      "presence.js:runOne",
    ]);
  });

  it("does not pick up non-exported or non-convex-constructor declarations", () => {
    const source = `
      const helper = () => 1; // not exported
      export const CONFIG = { max: 5 }; // exported, but not a convex function call
      function localOnly() {} // not a variable statement at all
      export const clear = mutation({ args: {}, handler: async () => {} });
    `;
    expect(expectedIdentifiersFromSource(source, "misc")).toEqual(["misc.js:clear"]);
  });

  it("ignores framework-component exports this scanner cannot see into (workflow.define, destructured syncApi)", () => {
    // These are real, deployed, legitimate functions (agentWorkflows.freeAutoWorkflow,
    // prosemirror.getSnapshot) that this AST scan correctly does NOT find — the
    // CLI script treats that gap as informational "extra", never a hard failure.
    const source = `
      export const freeAutoWorkflow = workflow.define({ args: {}, handler: async () => {} });
      export const { getSnapshot, submitSteps } = prosemirrorSync.syncApi({});
    `;
    expect(expectedIdentifiersFromSource(source, "agentWorkflows")).toEqual([]);
  });

  it("returns an empty list for a module with no convex functions at all", () => {
    expect(expectedIdentifiersFromSource("export const X = 1;\nexport function y() {}", "helpers")).toEqual([]);
  });
});

describe("diffDeployState — the silent-clobber detector", () => {
  it("is ok when the expected set is a subset of what's deployed (nothing missing)", () => {
    const diff = diffDeployState(["a.js:x", "a.js:y"], ["a.js:x", "a.js:y", "a.js:z"]);
    expect(diff.ok).toBe(true);
    expect(diff.missing).toEqual([]);
    expect(diff.extra).toEqual(["a.js:z"]);
  });

  it("flags a missing function as the exact clobber signature: expected but not deployed", () => {
    // This is precisely what happened live: presence:releaseForAgent was
    // deployed, then vanished after someone else's concurrent deploy.
    const diff = diffDeployState(
      ["presence.js:heartbeatForAgent", "presence.js:releaseForAgent"],
      ["presence.js:heartbeatForAgent"], // releaseForAgent silently clobbered
    );
    expect(diff.ok).toBe(false);
    expect(diff.missing).toEqual(["presence.js:releaseForAgent"]);
  });

  it("reports multiple missing functions sorted, for a readable failure message", () => {
    const diff = diffDeployState(["m.js:c", "m.js:a", "m.js:b"], []);
    expect(diff.missing).toEqual(["m.js:a", "m.js:b", "m.js:c"]);
    expect(diff.ok).toBe(false);
  });

  it("is ok with zero expected and zero deployed (an empty convex/ directory edge case)", () => {
    expect(diffDeployState([], [])).toMatchObject({ ok: true, missing: [], extra: [] });
  });
});
