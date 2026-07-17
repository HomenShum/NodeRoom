import { describe, expect, it } from "vitest";
import { auditUiLayerImports } from "../src/design/uiLayerPolicy";

describe("UI layer import policy", () => {
  it("accepts the approved primitive and motion boundaries", () => {
    const result = auditUiLayerImports({
      "src/components/ui/dialog.tsx": 'import { Dialog } from "radix-ui";',
      "src/components/ai-elements/reasoning.tsx": 'import { useControllableState } from "@radix-ui/react-use-controllable-state";',
      "src/components/ai-elements/shimmer.tsx": 'import { motion } from "motion/react";',
      "src/motion/gsap-client.ts": 'import { gsap } from "gsap";',
      "src/components/effects/react-bits/BlurText.tsx": 'import { motion } from "motion/react";',
      "src/components/backgrounds/vanta/VantaScene.tsx": 'const effect = import("vanta/dist/vanta.net.min");',
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, findings: [] }));
  });

  it("rejects primitive and motion imports from feature code", () => {
    const result = auditUiLayerImports({
      "src/ui/Feature.tsx": [
        'import { Dialog } from "radix-ui";',
        'import gsap from "gsap";',
        'import Lenis from "lenis";',
        'import VANTA from "vanta";',
      ].join("\n"),
    });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.packageName)).toEqual(["radix-ui", "gsap", "lenis", "vanta"]);
  });

  it("keeps product state out of vendor wrappers", () => {
    const result = auditUiLayerImports({
      "src/components/ui/agent-button.tsx": 'import { useStore } from "../../app/store";',
      "src/motion/use-run-timeline.ts": 'import type { AgentStep } from "../nodeagent/core/types";',
    });

    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.every((finding) => finding.reason.includes("through props"))).toBe(true);
  });
});
