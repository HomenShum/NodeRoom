import { describe, expect, it, vi } from "vitest";
import {
  generateEmailVerificationToken,
  normalizeAuthEmail,
  sendNodeRoomVerificationEmail,
} from "../convex/authEmail";

describe("password email verification", () => {
  it("normalizes account email identifiers and rejects malformed values", () => {
    expect(normalizeAuthEmail(" Person@Example.COM ")).toBe("person@example.com");
    expect(() => normalizeAuthEmail("not-an-email")).toThrow("invalid_email");
  });

  it("generates an email-bound eight digit challenge", async () => {
    const token = await generateEmailVerificationToken();
    expect(token).toMatch(/^\d{8}$/);
  });

  it("fails closed when the production mail transport is absent", async () => {
    await expect(sendNodeRoomVerificationEmail(
      { identifier: "person@example.com", token: "12345678" },
      {},
      vi.fn() as unknown as typeof fetch,
    )).rejects.toThrow("email_delivery_not_configured");
  });

  it("sends only the verification challenge through the configured transport", async () => {
    let requestBody = "";
    const send = vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
      requestBody = String(request?.body ?? "");
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    await sendNodeRoomVerificationEmail(
      { identifier: "Person@Example.com", token: "12345678" },
      { AUTH_RESEND_KEY: "test-key", AUTH_EMAIL_FROM: "NodeRoom <accounts@auth.noderoom.live>" },
      send,
    );

    expect(send).toHaveBeenCalledTimes(1);
    const body = JSON.parse(requestBody);
    expect(body.to).toBe("person@example.com");
    expect(body.text).toContain("12345678");
    expect(requestBody).not.toContain("test-key");
  });
});
