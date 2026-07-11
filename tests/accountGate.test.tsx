// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountGate } from "../src/ui/auth/AccountGate";

const signIn = vi.fn(async (_provider: string, _params?: unknown) => ({ signingIn: true }));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn, signOut: vi.fn() }),
}));

describe("AccountGate", () => {
  afterEach(() => {
    signIn.mockClear();
    vi.unstubAllEnvs();
  });

  it("starts GitHub OAuth with a same-page return target", async () => {
    vi.stubEnv("VITE_NODEROOM_AUTH_PROVIDER", "github");
    render(<AccountGate action="create this workspace" onCancel={() => undefined} />);
    fireEvent.click(screen.getByTestId("sign-in-github"));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("github", { redirectTo: window.location.href }));
    expect(screen.getByText(/room code remains an invitation/i)).toBeTruthy();
  });

  it("keeps the password provider explicit and development-labelled", async () => {
    vi.stubEnv("VITE_NODEROOM_AUTH_PROVIDER", "password");
    render(<AccountGate action="join this room" mobile onCancel={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "qa@noderoom.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "strong-password" } });
    fireEvent.click(screen.getByTestId("sign-in-password"));
    await waitFor(() => expect(signIn).toHaveBeenCalled());
    expect(signIn.mock.calls[0]?.[0]).toBe("password");
    expect(screen.getByText(/development authentication/i)).toBeTruthy();
  });
});
