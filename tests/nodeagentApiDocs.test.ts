import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVER_PRODUCTION_TOOL_NAMES } from "../src/nodeagent/skills/server/productionTools";

describe("NodeAgent agent-ready API docs", () => {
  it("documents every production tool with use, recovery, and example-call guidance", () => {
    const doc = readFileSync("docs/nodeagent/AGENT_READY_API.md", "utf8");

    for (const toolName of SERVER_PRODUCTION_TOOL_NAMES) {
      const sectionStart = doc.indexOf(`### ${toolName}`);
      expect(sectionStart, `${toolName} missing from API docs`).toBeGreaterThanOrEqual(0);
      const nextSection = doc.indexOf("\n### ", sectionStart + 1);
      const section = doc.slice(sectionStart, nextSection === -1 ? undefined : nextSection);
      expect(section, `${toolName} missing When to use`).toContain("- When to use:");
      expect(section, `${toolName} missing When not to use`).toContain("- When not to use:");
      expect(section, `${toolName} missing Recovery path`).toContain("- Recovery path:");
      expect(section, `${toolName} missing Example call`).toContain("- Example call:");
    }
  });
});
