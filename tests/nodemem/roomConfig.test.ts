import { describe, it, expect } from "vitest";
import { pickRoomNodeMem, DEFAULT_NODEMEM_MAX_TOKENS } from "../../src/nodemem/core/roomConfig";

// Regression guard for the benchmark defect: as originally written, every variant ran identically
// because the per-room mode + token budget never reached the agent. This pure picker is the unit
// the Convex resolver defers to — it must (a) prefer a per-room override and (b) honor its budget.
describe("NodeMem per-room config resolution (pickRoomNodeMem)", () => {
  it("falls back to the global mode + default budget when no override row exists", () => {
    expect(pickRoomNodeMem(null, "off")).toEqual({ mode: "off", maxTokens: DEFAULT_NODEMEM_MAX_TOKENS });
    expect(pickRoomNodeMem(undefined, "shadow")).toEqual({ mode: "shadow", maxTokens: DEFAULT_NODEMEM_MAX_TOKENS });
  });

  it("uses the per-room override mode over the global mode", () => {
    // Global is off (production-safe default), but this room opts into active injection.
    expect(pickRoomNodeMem({ mode: "active_ab" }, "off")).toEqual({
      mode: "active_ab",
      maxTokens: DEFAULT_NODEMEM_MAX_TOKENS,
    });
  });

  it("honors the per-room token budget so bounded (600) and full (1200) actually differ", () => {
    expect(pickRoomNodeMem({ mode: "active_ab", maxTokens: 600 }, "off").maxTokens).toBe(600);
    expect(pickRoomNodeMem({ mode: "active_ab", maxTokens: 1200 }, "off").maxTokens).toBe(1200);
  });

  it("treats a null/undefined override budget as the default", () => {
    expect(pickRoomNodeMem({ mode: "shadow", maxTokens: null }, "off").maxTokens).toBe(DEFAULT_NODEMEM_MAX_TOKENS);
  });
});
