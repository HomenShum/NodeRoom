/**
 * Skill-RAG WIRING regression test.
 *
 * The skill_search / load_skill tools are useless unless they are actually wired into the
 * live agent: present in the server tool registry AND allowlisted in the reasoning frames.
 * These assertions guard that wiring so a future edit can't silently drop dynamic skill
 * retrieval from production. (Tool BEHAVIOR is covered by skillRag.test.ts.)
 */
import { describe, it, expect } from "vitest";
import { FRAME_TOOL_ALLOWLIST } from "../src/nodeagent/core/reasoningFrames";
import { selectFrameTools } from "../src/nodeagent/core/frameRunner";
import { SERVER_PRODUCTION_ROOM_TOOLS } from "../src/nodeagent/skills/server/productionTools";
import type { ReasoningFrame } from "../src/nodeagent/core/reasoningFrames";

const names = (tools: { name: string }[]) => new Set(tools.map((t) => t.name));

describe("skill-RAG wiring", () => {
  it("allowlists skill DISCOVERY in the plan phase", () => {
    expect(FRAME_TOOL_ALLOWLIST.plan).toContain("skill_search");
    expect(FRAME_TOOL_ALLOWLIST.plan).toContain("okf_search_skills");
  });

  it("allowlists skill DISCOVERY + LOAD in the execute phase", () => {
    expect(FRAME_TOOL_ALLOWLIST.execute).toContain("skill_search");
    expect(FRAME_TOOL_ALLOWLIST.execute).toContain("load_skill");
  });

  it("includes skill_search + load_skill in the server production tool registry", () => {
    const n = names(SERVER_PRODUCTION_ROOM_TOOLS);
    expect(n.has("skill_search")).toBe(true);
    expect(n.has("load_skill")).toBe(true);
  });

  it("includes okf_search_skills in the registry (via OKF retrieval tools)", () => {
    expect(names(SERVER_PRODUCTION_ROOM_TOOLS).has("okf_search_skills")).toBe(true);
  });

  it("EXPOSES load_skill + skill_search to an execute-phase frame for a skill-relevant goal", () => {
    // Real allowlist + real registry + a goal that should pull the skill-class tools through RAG.
    const frame = { phase: "execute", toolAllowlist: FRAME_TOOL_ALLOWLIST.execute } as unknown as ReasoningFrame;
    const selection = selectFrameTools(frame, SERVER_PRODUCTION_ROOM_TOOLS, "build a powerpoint deck from my messy meeting notes");
    expect(selection.allowedToolNames).toContain("load_skill");
    expect(selection.allowedToolNames).toContain("skill_search");
  });

  it("does NOT leak skill tools into a frame that does not allowlist them (intake)", () => {
    const frame = { phase: "intake", toolAllowlist: FRAME_TOOL_ALLOWLIST.intake } as unknown as ReasoningFrame;
    const selection = selectFrameTools(frame, SERVER_PRODUCTION_ROOM_TOOLS, "normalize this room intake");
    expect(selection.allowedToolNames).not.toContain("load_skill");
    expect(selection.allowedToolNames).not.toContain("skill_search");
  });
});
