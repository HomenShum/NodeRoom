import { describe, expect, it } from "vitest";
import type { VisualArtifactKind } from "@nodebook/contracts";

import {
  decodeNodeBookVisualEnvelope,
  MAX_NODEBOOK_VISUAL_ENVELOPE_BYTES,
  NODEBOOK_VISUAL_SCHEMA_VERSION,
} from "../src/notebook/visualArtifactEnvelope";

const formats: ReadonlyArray<[VisualArtifactKind, string]> = [
  ["mindmap", "structured-json"],
  ["flow", "structured-json"],
  ["chart", "vega-lite-json"],
  ["drawio", "drawio-xml"],
  ["mermaid", "mermaid"],
  ["infographic", "infographic-json"],
];

const context = { artifactId: "note-visual-1", title: "Decision artifact", version: 41 };
const digest = "a".repeat(64);

describe("NodeRoom visual artifact envelope boundary", () => {
  it.each(formats)("accepts a canonical %s envelope without changing host identity", (kind, format) => {
    const result = decodeNodeBookVisualEnvelope({
      schemaVersion: NODEBOOK_VISUAL_SCHEMA_VERSION,
      kind,
      format,
      payload: "canonical payload",
      contentHash: digest.toUpperCase(),
    }, context);

    expect(result).toEqual({
      status: "valid",
      artifact: {
        artifactId: context.artifactId,
        kind,
        format,
        payload: "canonical payload",
        title: context.title,
        version: context.version,
        contentHash: digest,
      },
    });
  });

  it.each([
    ["non-object", "text", "INVALID_ENVELOPE"],
    ["wrong schema", { schemaVersion: "v0" }, "UNSUPPORTED_SCHEMA"],
    ["unknown kind", { schemaVersion: NODEBOOK_VISUAL_SCHEMA_VERSION, kind: "iframe" }, "UNSUPPORTED_KIND"],
    ["kind/format mismatch", { schemaVersion: NODEBOOK_VISUAL_SCHEMA_VERSION, kind: "chart", format: "mermaid" }, "UNSUPPORTED_FORMAT"],
    ["empty payload", { schemaVersion: NODEBOOK_VISUAL_SCHEMA_VERSION, kind: "mermaid", format: "mermaid", payload: "", contentHash: digest }, "INVALID_PAYLOAD"],
    ["fake digest", { schemaVersion: NODEBOOK_VISUAL_SCHEMA_VERSION, kind: "mermaid", format: "mermaid", payload: "flowchart LR", contentHash: "trusted" }, "INVALID_CONTENT_HASH"],
  ])("rejects the %s scenario honestly", (_scenario, value, errorCode) => {
    const result = decodeNodeBookVisualEnvelope(value, context);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.errorCode).toBe(errorCode);
  });

  it("rejects an agent-sized oversized payload before renderer/plugin work", () => {
    const result = decodeNodeBookVisualEnvelope({
      schemaVersion: NODEBOOK_VISUAL_SCHEMA_VERSION,
      kind: "mermaid",
      format: "mermaid",
      payload: "x".repeat(MAX_NODEBOOK_VISUAL_ENVELOPE_BYTES),
      contentHash: digest,
    }, context);

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.errorCode).toBe("ARTIFACT_TOO_LARGE");
  });

  it("stays bounded and deterministic during a 1,000-version sustained decode", () => {
    const envelope = {
      schemaVersion: NODEBOOK_VISUAL_SCHEMA_VERSION,
      kind: "mermaid",
      format: "mermaid",
      payload: "flowchart LR\nA-->B",
      contentHash: digest,
    };
    const versions = Array.from({ length: 1_000 }, (_, version) => {
      const result = decodeNodeBookVisualEnvelope(envelope, { ...context, version });
      return result.status === "valid" ? result.artifact.version : -1;
    });

    expect(versions).toHaveLength(1_000);
    expect(versions[0]).toBe(0);
    expect(versions[999]).toBe(999);
  });
});
