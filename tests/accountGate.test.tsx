// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountGate } from "../src/ui/auth/AccountGate";

const signIn = vi.fn(async (_provider: string, _params?: unknown) => ({ signingIn: true }));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn, signOut: vi.fn() }),
}));

describe("AccountGate", () => {
  beforeEach(() => {
    signIn.mockReset();
    signIn.mockResolvedValue({ signingIn: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts GitHub OAuth with a same-page return target", async () => {
    vi.stubEnv("VITE_NODEROOM_AUTH_PROVIDER", "github");
    render(<AccountGate action="create this workspace" onCancel={() => undefined} />);

    fireEvent.click(screen.getByTestId("sign-in-github"));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith("github", { redirectTo: window.location.href }));
    expect(screen.getByText(/room code remains an invitation/i)).toBeTruthy();
  });

  it("submits an explicit password sign-up without development-only copy", async () => {
    vi.stubEnv("VITE_NODEROOM_AUTH_PROVIDER", "password");
    render(<AccountGate action="join this room" mobile onCancel={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "qa@noderoom.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "strong-password" } });
    fireEvent.click(screen.getByTestId("sign-in-password"));

    await waitFor(() => expect(signIn).toHaveBeenCalled());
    expect(signIn.mock.calls[0]?.[0]).toBe("password");
    const form = signIn.mock.calls[0]?.[1] as FormData;
    expect(form.get("flow")).toBe("signUp");
    expect(form.get("email")).toBe("qa@noderoom.test");
    expect(screen.getByText(/credentials are handled by NodeRoom/i)).toBeTruthy();
    expect(screen.queryByText(/development authentication/i)).toBeNull();
  });

  it("offers GitHub and email together when both providers are enabled", () => {
    vi.stubEnv("VITE_NODEROOM_AUTH_PROVIDER", "both");
    render(<AccountGate action="create this workspace" onCancel={() => undefined} />);

    expect(screen.getByTestId("sign-in-github")).toBeTruthy();
    expect(screen.getByTestId("sign-in-password")).toBeTruthy();
    expect(screen.getByText("or use email")).toBeTruthy();
  });

  it("requires the emailed code before a new password account signs in", async () => {
    vi.stubEnv("VITE_NODEROOM_AUTH_PROVIDER", "password");
    signIn.mockResolvedValueOnce({ signingIn: false }).mockResolvedValueOnce({ signingIn: true });
    render(<AccountGate action="create this workspace" onCancel={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: " New.User@Example.com " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "strong-password" } });
    fireEvent.click(screen.getByTestId("sign-in-password"));

    await screen.findByRole("heading", { name: "Verify your email" });
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getAllByText(/new.user@example.com/i)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "12345678" } });
    fireEvent.click(screen.getByTestId("verify-email-code"));

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    expect(signIn.mock.calls[1]).toEqual(["password", {
      flow: "email-verification",
      email: "new.user@example.com",
      code: "12345678",
    }]);
  });

  it("resends a verification challenge without retaining the password", async () => {
    vi.stubEnv("VITE_NODEROOM_AUTH_PROVIDER", "password");
    signIn.mockResolvedValue({ signingIn: false });
    render(<AccountGate action="join this room" onCancel={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "qa@noderoom.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "strong-password" } });
    fireEvent.click(screen.getByTestId("sign-in-password"));
    await screen.findByRole("heading", { name: "Verify your email" });
    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));

    await waitFor(() => expect(signIn).toHaveBeenLastCalledWith("password", {
      flow: "email-verification",
      email: "qa@noderoom.test",
    }));
    expect(screen.getByText(/new verification code was sent/i)).toBeTruthy();
  });
});
