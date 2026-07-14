import { type FormEvent, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowLeft, Github, LoaderCircle, LockKeyhole } from "lucide-react";
import { launchAuthProvider } from "../../auth/launchAuth";
import "./accountGate.css";

export function AccountGate({
  action,
  loading = false,
  mobile = false,
  onCancel,
}: {
  action: string;
  loading?: boolean;
  mobile?: boolean;
  onCancel: () => void;
}) {
  const { signIn } = useAuthActions();
  const provider = launchAuthProvider();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWithGitHub = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await signIn("github", { redirectTo: window.location.href });
    } catch (reason) {
      setError(authErrorMessage(reason));
      setSubmitting(false);
    }
  };

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData(event.currentTarget);
      form.set("flow", flow);
      await signIn("password", form);
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const pending = loading || submitting;
  return (
    <div className="nr-auth-root" data-mobile={String(mobile)} data-testid="account-auth-gate">
      <main className="nr-auth-panel" aria-busy={pending}>
        <button className="nr-auth-back" type="button" onClick={onCancel} disabled={pending}>
          <ArrowLeft size={17} /> Back
        </button>
        <span className="nr-auth-mark" aria-hidden="true">N</span>
        <div className="nr-auth-heading">
          <span className="nr-auth-kicker"><LockKeyhole size={15} /> Account required</span>
          <h1>Sign in to {action}</h1>
          <p>Your account identifies your room membership. The room code remains an invitation for other signed-in editors, so share it intentionally.</p>
        </div>

        {loading ? (
          <div className="nr-auth-loading" role="status"><LoaderCircle className="nr-auth-spin" size={20} /> Checking your session...</div>
        ) : (
          <div className="nr-auth-methods">
            {provider !== "password" && (
              <button className="nr-auth-primary" type="button" onClick={() => void signInWithGitHub()} disabled={submitting} data-testid="sign-in-github">
                {submitting ? <LoaderCircle className="nr-auth-spin" size={18} /> : <Github size={18} />}
                {submitting ? "Opening GitHub..." : "Continue with GitHub"}
              </button>
            )}
            {provider === "both" && <div className="nr-auth-divider"><span>or use email</span></div>}
            {provider !== "github" && (
              <form className="nr-auth-form" onSubmit={(event) => void submitPassword(event)}>
                <div className="nr-auth-segments" role="group" aria-label="Account action">
                  <button type="button" data-active={String(flow === "signIn")} onClick={() => setFlow("signIn")}>Sign in</button>
                  <button type="button" data-active={String(flow === "signUp")} onClick={() => setFlow("signUp")}>Create account</button>
                </div>
                <label><span>Email</span><input name="email" type="email" autoComplete="email" required /></label>
                <label><span>Password</span><input name="password" type="password" autoComplete={flow === "signUp" ? "new-password" : "current-password"} minLength={8} required /></label>
                <button className="nr-auth-primary" type="submit" disabled={submitting} data-testid="sign-in-password">
                  {submitting && <LoaderCircle className="nr-auth-spin" size={18} />}
                  {flow === "signIn" ? "Sign in" : "Create account"}
                </button>
                <p className="nr-auth-provider-note">Credentials are handled by NodeRoom's authentication service.</p>
              </form>
            )}
          </div>
        )}
        {error && <div className="nr-auth-error" role="alert">{error}</div>}
        <p className="nr-auth-trust">Authentication does not make a room public. Access still requires the room code or invite link.</p>
      </main>
    </div>
  );
}

function authErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/InvalidAccountId|InvalidSecret|invalid credentials/i.test(message)) return "Email or password was not accepted.";
  if (/already exists/i.test(message)) return "An account with that email already exists. Sign in instead.";
  if (/network|fetch/i.test(message)) return "Could not reach the authentication service. Check your connection and try again.";
  return "Authentication did not complete. Try again.";
}
