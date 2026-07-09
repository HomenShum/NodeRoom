import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROOFLOOP_PROVIDER_IDS,
  proofloopProviderReceiptPath,
  setupProofloopProvider,
  setupProofloopProviders,
} from "../src/eval/proofloopProviderSetup";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Proof Loop provider setup receipts", () => {
  it("records missing provider credentials without pretending setup is ready", async () => {
    const root = tempRoot();

    const receipt = await setupProofloopProvider("rocketride", {
      root,
      generatedAt: "2026-07-08T00:00:00.000Z",
      env: {},
    });

    expect(receipt.status).toBe("needs_credentials");
    expect(receipt.env.missing).toEqual(["ROCKETRIDE_API_KEY", "ROCKETRIDE_API_URL"]);
    expect(existsSync(proofloopProviderReceiptPath(root, "rocketride"))).toBe(true);
  });

  it("covers every real provider lane when setting up all providers", async () => {
    const root = tempRoot();

    const receipts = await setupProofloopProviders([...PROOFLOOP_PROVIDER_IDS], {
      root,
      generatedAt: "2026-07-08T00:00:00.000Z",
      env: {},
    });

    expect(receipts.map((receipt) => receipt.providerId)).toEqual([...PROOFLOOP_PROVIDER_IDS]);
    for (const providerId of PROOFLOOP_PROVIDER_IDS) {
      expect(existsSync(proofloopProviderReceiptPath(root, providerId))).toBe(true);
    }
    expect(receipts.find((receipt) => receipt.providerId === "opsera")?.status).toBe("needs_adapter");
    expect(receipts.filter((receipt) => receipt.providerId !== "opsera").every((receipt) => receipt.status === "needs_credentials")).toBe(true);
  });

  it("records Opsera as a requested provider lane that still needs an adapter", async () => {
    const root = tempRoot();

    const receipt = await setupProofloopProvider("opsera", {
      root,
      generatedAt: "2026-07-08T00:00:00.000Z",
      env: {},
    });

    expect(receipt.status).toBe("needs_adapter");
    expect(receipt.checks[0]).toMatchObject({
      id: "provider-adapter",
      status: "needs_adapter",
    });
    expect(existsSync(proofloopProviderReceiptPath(root, "opsera"))).toBe(true);
  });

  it("runs a real endpoint check when provider env is configured", async () => {
    const root = tempRoot();
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const receipt = await setupProofloopProvider("butterbase", {
      root,
      fetchImpl,
      generatedAt: "2026-07-08T00:00:00.000Z",
      env: {
        BUTTERBASE_API_URL: "https://api.butterbase.example/v1/app_demo",
        BUTTERBASE_API_KEY: "bb_test_key",
      },
    });

    expect(receipt.status).toBe("ready");
    expect(calls).toEqual(["https://api.butterbase.example/v1/app_demo"]);
    expect(receipt.checks.map((check) => check.id)).toContain("live-provider");
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-provider-"));
  tempRoots.push(root);
  return root;
}
