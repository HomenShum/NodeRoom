import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("native notebook passive-intelligence source ownership", () => {
  // ONE passive source per notebook edit: the sync adapter AND the agent write
  // lane must never enqueue passive activity directly — the read-model refresh
  // goes through notebookDirtyEvents → the ACL-gated processor, which owns the
  // single outbox item.
  for (const file of ["convex/prosemirror.ts", "convex/notebookAgent.ts"]) {
    it(`keeps ${file} out of the passive activity enqueue path`, () => {
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

      expect(source).not.toMatch(/enqueueRoomActivity/);
      expect(source).not.toMatch(/roomActivityOutbox/);
    });
  }
});
