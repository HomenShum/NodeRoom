import type {
  ExternalReferenceRunSnapshot,
  NoteSurfaceReferenceConsumption,
} from "../../src/engine/noteSurfaceReference";
import { noteSurfaceReferenceView } from "../../src/engine/noteSurfaceReference";

const MAX_TRUST_POLICY_BYTES = 64 * 1024;
const MAX_TRUST_CREDENTIALS = 128;
const MAX_EXTERNAL_RUN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTESTATION_SKEW_MS = 5 * 60 * 1000;
const SERVICE_ATTESTATION_DOMAIN = "NODEKIT_REFERENCE_SERVICE_ATTESTATION_V1";
const MOBBIN_ATTESTATION_PURPOSE = "mobbin-external-reference-run";
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const HASH = /^[0-9a-f]{64}$/;

interface ReferenceServiceCredential {
  publicKey: string;
  algorithm: "Ed25519";
  assurance: "S2" | "S3";
  purposes: string[];
  producers: string[];
}

interface ReferenceTrustPolicy {
  schemaVersion: "nodekit.reference-trust-policy/v1";
  credentials: Record<string, ReferenceServiceCredential>;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object") throw new Error("non-canonical-value");
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

function pemSpkiBytes(pem: string): Uint8Array {
  const match = /^-----BEGIN PUBLIC KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END PUBLIC KEY-----\r?\n?$/.exec(pem);
  if (!match) throw new Error("invalid-public-key-pem");
  return decodeBase64(match[1]!.replace(/\s/g, ""));
}

async function sha256Utf8(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseTrustPolicy(raw: string): ReferenceTrustPolicy {
  if (new TextEncoder().encode(raw).byteLength > MAX_TRUST_POLICY_BYTES) {
    throw new Error("trust-policy-too-large");
  }
  const policy = JSON.parse(raw) as ReferenceTrustPolicy;
  if (
    policy?.schemaVersion !== "nodekit.reference-trust-policy/v1"
    || !policy.credentials
    || typeof policy.credentials !== "object"
    || Array.isArray(policy.credentials)
    || Object.keys(policy.credentials).length > MAX_TRUST_CREDENTIALS
  ) {
    throw new Error("invalid-trust-policy");
  }
  return policy;
}

function serviceAttestationSigningBytes(
  attestation: ExternalReferenceRunSnapshot["attestation"],
): Uint8Array {
  return new TextEncoder().encode(canonical({
    domain: SERVICE_ATTESTATION_DOMAIN,
    purpose: attestation.purpose,
    keyId: attestation.keyId,
    subjectDigest: attestation.subjectDigest,
    signedAt: attestation.signedAt,
  }));
}

/**
 * Server-only authority gate. Digest closure is necessary but cannot establish
 * who signed an external observation; this gate pins the exact NodeKit trust
 * policy bytes and verifies the service signature before persistence.
 */
export async function verifyNoteSurfaceReferenceAuthority(
  record: NoteSurfaceReferenceConsumption,
  options: {
    now?: number;
    trustPolicyJson?: string;
  } = {},
): Promise<string[]> {
  const findings: string[] = [];
  const rawPolicy = options.trustPolicyJson ?? process.env.NODEKIT_REFERENCE_TRUST_POLICY_JSON;
  if (!rawPolicy) return ["external-run-trust-policy-unconfigured"];

  let policy: ReferenceTrustPolicy;
  try {
    policy = parseTrustPolicy(rawPolicy);
  } catch {
    return ["external-run-trust-policy-invalid"];
  }

  const policyDigest = await sha256Utf8(rawPolicy);
  const view = noteSurfaceReferenceView(record);
  if (
    !HASH.test(view.scoreReceipt.trustPolicy.digest)
    || view.scoreReceipt.trustPolicy.path !== "reference/trust-policy.json"
    || view.scoreReceipt.trustPolicy.digest !== policyDigest
  ) {
    findings.push("external-run-trust-policy-drift");
  }

  const run = view.externalRun;
  const attestation = run.attestation;
  const credential = policy.credentials[attestation.keyId];
  const producer = `${run.producer.tool}@${run.producer.version}`;
  if (
    !credential
    || credential.algorithm !== "Ed25519"
    || !["S2", "S3"].includes(credential.assurance)
    || !Array.isArray(credential.purposes)
    || !credential.purposes.includes(MOBBIN_ATTESTATION_PURPOSE)
    || !Array.isArray(credential.producers)
    || !credential.producers.includes(producer)
  ) {
    findings.push("external-run-service-credential-untrusted");
    return [...new Set(findings)].sort();
  }

  const now = options.now ?? Date.now();
  const checkedAt = Date.parse(run.checkedAt);
  const expiresAt = Date.parse(run.expiresAt);
  const signedAt = Date.parse(attestation.signedAt);
  if (
    !Number.isFinite(checkedAt)
    || !Number.isFinite(expiresAt)
    || !Number.isFinite(signedAt)
    || expiresAt <= checkedAt
    || expiresAt - checkedAt > MAX_EXTERNAL_RUN_TTL_MS
    || now > expiresAt
    || signedAt < checkedAt - MAX_ATTESTATION_SKEW_MS
    || signedAt > now + MAX_ATTESTATION_SKEW_MS
    || signedAt > expiresAt
  ) {
    findings.push("external-run-attestation-stale");
  }

  try {
    if (!BASE64URL.test(attestation.signature)) throw new Error("invalid-signature-encoding");
    const signature = decodeBase64(attestation.signature);
    if (
      signature.byteLength !== 64
      || encodeBase64Url(signature) !== attestation.signature
    ) throw new Error("invalid-signature");
    const key = await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(pemSpkiBytes(credential.publicKey)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const verified = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      toArrayBuffer(signature),
      toArrayBuffer(serviceAttestationSigningBytes(attestation)),
    );
    if (!verified) findings.push("external-run-service-signature-invalid");
  } catch {
    findings.push("external-run-service-signature-invalid");
  }

  return [...new Set(findings)].sort();
}
