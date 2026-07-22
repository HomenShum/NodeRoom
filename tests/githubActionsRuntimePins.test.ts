import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const expectedPins = {
  checkout: {
    sha: "3d3c42e5aac5ba805825da76410c181273ba90b1",
    version: "v7.0.1",
  },
  "setup-node": {
    sha: "820762786026740c76f36085b0efc47a31fe5020",
    version: "v7.0.0",
  },
  "setup-python": {
    sha: "5fda3b95a4ea91299a34e894583c3862153e4b97",
    version: "v7.0.0",
  },
  "upload-artifact": {
    sha: "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    version: "v7.0.1",
  },
  "github-script": {
    sha: "3a2844b7e9c422d3c10d287c895573f7108da1b3",
    version: "v9.0.0",
  },
} as const;

const workflowDirectory = join(process.cwd(), ".github", "workflows");
const workflowFiles = readdirSync(workflowDirectory)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => join(workflowDirectory, name));
const files = [...workflowFiles, join(process.cwd(), "proofloop", "templates", "github-proofloop-gate.yml")];

describe("GitHub Actions JavaScript runtime pins", () => {
  it("uses immutable Node 24 release commits with readable version comments", () => {
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);

      for (const [index, line] of lines.entries()) {
        const action = Object.keys(expectedPins).find((name) => line.includes(`actions/${name}@`));
        if (!action) continue;

        const pin = expectedPins[action as keyof typeof expectedPins];
        expect(line.trim(), `${file}:${index + 1}`).toContain(
          `uses: actions/${action}@${pin.sha} # ${pin.version}`,
        );
      }
    }
  });

  it("binds Node Platform conformance to the warning-free immutable producer", () => {
    const workflow = readFileSync(join(workflowDirectory, "node-platform-conformance.yml"), "utf8");
    expect(workflow).toContain(
      "HomenShum/node-platform/.github/workflows/repo-conformance.yml@5c9aa6443ca8e61dc8886fbf0a0b4a7b72858e63 # Node 24 action pins (PR #8)",
    );
  });
});
