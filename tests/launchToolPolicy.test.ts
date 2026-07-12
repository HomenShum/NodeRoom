import { describe, expect, it } from "vitest";
import {
  LAUNCH_UNMETERED_PROVIDER_TOOL_NAMES,
  serverProductionRoomToolsForEnv,
} from "../src/nodeagent/skills/server/productionTools";

describe("launch tool spend policy", () => {
  it("removes nested unmetered providers and subagents in pilot/public posture", () => {
    const names = serverProductionRoomToolsForEnv({ NODEAGENT_LAUNCH_MODE: "public_launch" }).map((tool) => tool.name);
    for (const blocked of LAUNCH_UNMETERED_PROVIDER_TOOL_NAMES) expect(names).not.toContain(blocked);
    expect(names).toContain("read_range");
    expect(names).toContain("fetch_source");
    expect(names).toContain("workbook_session");
  });

  it("preserves the full registry in development and benchmark posture", () => {
    for (const mode of ["development", "benchmark"]) {
      const names = serverProductionRoomToolsForEnv({ NODEAGENT_LAUNCH_MODE: mode }).map((tool) => tool.name);
      for (const tool of LAUNCH_UNMETERED_PROVIDER_TOOL_NAMES) expect(names).toContain(tool);
    }
  });
});
