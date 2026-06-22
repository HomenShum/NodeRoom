import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("design prototype parity", () => {
  test("desktop landing keeps the NodeAgent room prototype framing", () => {
    const landing = source("src/ui/Landing.tsx");

    expect(landing).toContain("NodeAgent · live collaborative rooms");
    expect(landing).toContain("Bring people and");
    expect(landing).toContain("agents");
    expect(landing).toContain("Chat, a shared workspace, and NodeAgents");
    expect(landing).toContain("Public by default");
    expect(landing).toContain("Up to four panels");
    expect(landing).toContain("Locks, not collisions");
    expect(landing).toContain("The public surface");
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
