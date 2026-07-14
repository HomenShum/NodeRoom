import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("design prototype parity", () => {
  // Landing framing moved from the room prototype to landing-v2
  // (design-reference/room/landing-v2.jsx, Prod Parity Handoff §1):
  // Literal first-run value + looping demo + live-proof pill.
  test("desktop landing keeps the landing-v2 design framing", () => {
    const landing = source("src/ui/Landing.tsx");

    expect(landing).toContain("Work with AI.");
    expect(landing).toContain("Review every change.");
    expect(landing).toContain("Shared workrooms for people and NodeAgents");
    // The key visual is the scripted product-demo loop, every frame present.
    for (const frame of ["lock", "cite", "commit", "draft", "smart-merge", "v43"]) {
      expect(landing).toContain(`"${frame}"`);
    }
    // Live-proof pill: real counts in live mode, honest demo tag otherwise.
    expect(landing).toContain("rooms live");
    expect(landing).toContain("cells committed today");
    // Entry flows survive the redesign — e2e depends on these testids.
    expect(landing).toContain("start-demo-room");
    expect(landing).toContain("create-room-submit");
    // The old prototype copy is fully retired, not half-migrated.
    expect(landing).not.toContain("NodeAgent · live collaborative rooms");
    expect(landing).not.toContain("Chat, a shared workspace, and NodeAgents");
    expect(landing).not.toContain("A live room for banker-led diligence");
    expect(landing).not.toContain("Run startup diligence demo");
  });

  test("mobile memory route keeps the terracotta prototype home signals", () => {
    const data = source("src/ui/mobile/mobileData.ts");
    const screens = source("src/ui/mobile/MobileScreens.tsx");
    const frame = source("src/ui/mobile/MobileFrame.tsx");

    expect(data).toContain('name: "Q3 Diligence"');
    expect(data).toContain('title: "CardioNova investor update"');
    expect(data).toContain('title: "CardioNova sheet"');
    expect(data).toContain('title: "CardioNova work plan"');
    expect(data).toContain('title: "Funding evidence"');
    expect(screens).toContain("Open deck");
    expect(screens).toContain("Open sheet");
    expect(screens).toContain("Open plan");
    expect(screens).toContain("Open evidence");
    expect(frame).toContain("<StatusBar dark={dark} />");
  });
});
