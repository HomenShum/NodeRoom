import { artifactRendererRegistry, VISUAL_ARTIFACT_KINDS, type VisualArtifactKind } from "@nodebook/contracts";
import type { NodeBookArtifactSurfaceProps } from "@nodebook/react";

// Keep roughly 25% headroom below Convex's 1 MiB document limit for the
// surrounding artifact fields and encoding overhead.
const MAX_ELEMENT_VALUE_BYTES = 750_000;

export const NODEBOOK_VISUAL_ELEMENT_ID = "nodebook:artifact";
export const NODEBOOK_VISUAL_SCHEMA_VERSION = "nodebook.visual-artifact/v1";
export const MAX_NODEBOOK_VISUAL_ENVELOPE_BYTES = MAX_ELEMENT_VALUE_BYTES;

type DecodeContext = {
  artifactId: string;
  title: string;
  version: number;
};

export type NodeBookVisualEnvelopeDecodeResult =
  | { status: "absent" }
  | { status: "invalid"; errorCode: string; message: string }
  | { status: "valid"; artifact: NodeBookArtifactSurfaceProps };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(errorCode: string, message: string): NodeBookVisualEnvelopeDecodeResult {
  return { status: "invalid", errorCode, message };
}

export function decodeNodeBookVisualEnvelope(
  value: unknown,
  context: DecodeContext,
): NodeBookVisualEnvelopeDecodeResult {
  if (value === undefined || value === null) return { status: "absent" };

  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return invalid("INVALID_ENVELOPE", "The NodeBook artifact envelope is not serializable.");
  }
  if (new TextEncoder().encode(encoded).byteLength > MAX_NODEBOOK_VISUAL_ENVELOPE_BYTES) {
    return invalid("ARTIFACT_TOO_LARGE", "The NodeBook artifact envelope exceeds the 750 KB persisted-value limit.");
  }
  if (!isRecord(value)) return invalid("INVALID_ENVELOPE", "The NodeBook artifact envelope must be an object.");
  if (value.schemaVersion !== NODEBOOK_VISUAL_SCHEMA_VERSION) {
    return invalid("UNSUPPORTED_SCHEMA", `Unsupported NodeBook artifact schema: ${String(value.schemaVersion ?? "missing")}.`);
  }

  const kind = value.kind;
  if (typeof kind !== "string" || !VISUAL_ARTIFACT_KINDS.includes(kind as VisualArtifactKind)) {
    return invalid("UNSUPPORTED_KIND", `Unsupported NodeBook artifact kind: ${String(kind ?? "missing")}.`);
  }
  const format = value.format;
  if (typeof format !== "string" || artifactRendererRegistry[kind as VisualArtifactKind].format !== format) {
    return invalid("UNSUPPORTED_FORMAT", `Unsupported ${kind} format: ${String(format ?? "missing")}.`);
  }
  if (typeof value.payload !== "string" || value.payload.length === 0) {
    return invalid("INVALID_PAYLOAD", "The NodeBook artifact payload must be a non-empty string.");
  }
  if (typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(value.contentHash)) {
    return invalid("INVALID_CONTENT_HASH", "The NodeBook artifact content hash must be a SHA-256 hex digest.");
  }
  if (!Number.isSafeInteger(context.version) || context.version < 0) {
    return invalid("INVALID_VERSION", "The NodeRoom element version is invalid.");
  }

  return {
    status: "valid",
    artifact: {
      artifactId: context.artifactId,
      kind: kind as VisualArtifactKind,
      format,
      payload: value.payload,
      title: context.title,
      version: context.version,
      contentHash: value.contentHash.toLowerCase(),
    },
  };
}
