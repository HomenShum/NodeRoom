import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("voice microphone production policy", () => {
  it("allows same-origin browser microphone access on Vercel", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      headers?: Array<{ headers?: Array<{ key?: string; value?: string }> }>;
    };
    const permissionsPolicy = config.headers
      ?.flatMap((entry) => entry.headers ?? [])
      .find((header) => header.key?.toLowerCase() === "permissions-policy")
      ?.value;

    expect(permissionsPolicy).toContain("microphone=(self)");
    expect(permissionsPolicy).not.toContain("microphone=()");
  });
});
