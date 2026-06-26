import { describe, expect, it } from "vitest";
import { toolParameters } from "../src/nodeagent/models/convexModel";
import { SERVER_PRODUCTION_ROOM_TOOLS, SERVER_PRODUCTION_TOOL_NAMES } from "../src/nodeagent/skills/server/productionTools";
import { providerToolSchemaMismatches } from "../src/nodeagent/tools/schemaIntrospection";

function propertiesOf(schema: Record<string, unknown>) {
  return schema.properties && typeof schema.properties === "object"
    ? schema.properties as Record<string, unknown>
    : {};
}

describe("NodeAgent provider tool schemas", () => {
  it("does not advertise real production tools as empty-argument functions", () => {
    const emptyArgTools = new Set(["list_artifacts"]);

    for (const name of SERVER_PRODUCTION_TOOL_NAMES) {
      const schema = toolParameters(name);
      expect(schema.type, name).toBe("object");
      if (!emptyArgTools.has(name)) {
        expect(Object.keys(propertiesOf(schema)), name).not.toHaveLength(0);
      }
    }
  });

  it("advertises required source and search arguments to providers", () => {
    expect(toolParameters("search_sheet_context")).toMatchObject({
      required: ["query"],
      properties: { query: { type: "string" }, artifactId: { type: "string" } },
    });
    expect(toolParameters("source_open_literal")).toMatchObject({
      required: ["sourceArtifactId"],
      properties: { sourceArtifactId: { type: "string" } },
    });
    expect(toolParameters("source_resolve_citation")).toMatchObject({
      required: ["evidenceId"],
      properties: { evidenceId: { type: "string" } },
    });
    expect(toolParameters("capture_source")).toMatchObject({
      required: ["url", "goal"],
      properties: { url: { type: "string" }, goal: { type: "string" } },
    });
    expect(toolParameters("write_locked_cell_results")).toMatchObject({
      required: [],
      properties: { ops: { type: "array" }, cells: { type: "array" }, targetCells: {}, newValues: {}, currentVersion: {} },
    });
    expect(toolParameters("create_btb_deliverable_package")).toMatchObject({
      required: ["title", "narrative"],
      properties: { title: { type: "string" }, rows: { type: "array" } },
    });
  });

  it("keeps provider JSON schemas in parity with the canonical Zod tool surface", () => {
    const mismatches = SERVER_PRODUCTION_ROOM_TOOLS.flatMap((tool) =>
      providerToolSchemaMismatches(tool, toolParameters(tool.name)).map((mismatch) => `${mismatch.tool}: ${mismatch.reason}`),
    );

    expect(mismatches).toEqual([]);
  });
});
