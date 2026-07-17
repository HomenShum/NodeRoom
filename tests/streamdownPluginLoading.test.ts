import { describe, expect, it } from "vitest";
import { streamdownPluginRequirements } from "../src/components/ai-elements/streamdown-plugins";

describe("lazy Streamdown plugin selection", () => {
  it("keeps plain first-paint chat free of advanced renderer imports", () => {
    expect(streamdownPluginRequirements("The run completed with two sourced findings.")).toEqual({
      cjk: false,
      code: false,
      math: false,
      mermaid: false,
    });
    expect(streamdownPluginRequirements("ARR was $12.4M at quarter end.").math).toBe(false);
  });

  it("loads only the renderer families required by rich content", () => {
    expect(streamdownPluginRequirements("```ts\nconst value = 1;\n```")).toMatchObject({ code: true, math: false, mermaid: false });
    expect(streamdownPluginRequirements("$$x^2$$")).toMatchObject({ code: false, math: true, mermaid: false });
    expect(streamdownPluginRequirements("```mermaid\ngraph TD\nA-->B\n```")).toMatchObject({ code: true, mermaid: true });
    expect(streamdownPluginRequirements("証拠を確認しました").cjk).toBe(true);
  });
});
