import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Custom fallback. Receives the error + a reset() that clears the caught state and re-renders children. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Called once when an error is caught (e.g. to clear a stale session). */
  onError?: (error: Error) => void;
  /** When set, the DEFAULT fallback offers a "clear session & reload" recovery that purges these localStorage keys. */
  clearSessionPrefix?: string;
  /** Short label for the default fallback heading (e.g. "this room"). */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * App-wide render error boundary. Without this, any thrown error during render — a `useQuery` that
 * throws on a revoked/rotated proof, a lazy() chunk-load rejection after a redeploy, a null-deref in
 * a deep panel — tears down the whole React tree to a blank white screen with no recovery path.
 * This converts that into a recoverable UI (reload / clear-session / a caller-supplied fallback).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError?.(error);
    // Surface in dev/observability; never swallowed silently.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught", error);
  }

  reset = () => this.setState({ error: null });

  private clearSessionAndReload = () => {
    const prefix = this.props.clearSessionPrefix;
    try {
      if (prefix) {
        Object.keys(localStorage)
          .filter((k) => k.startsWith(prefix))
          .forEach((k) => localStorage.removeItem(k));
      }
    } catch {
      /* localStorage may be unavailable; reload is still useful */
    }
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 24,
          textAlign: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "var(--bg-primary, #13100D)",
          color: "var(--text-secondary, #cbd2da)",
        }}
      >
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text-primary, #f2f4f7)" }}>
          Something went wrong loading {this.props.label ?? "this view"}.
        </p>
        <p style={{ margin: 0, fontSize: 12.5, maxWidth: 460, opacity: 0.8, overflowWrap: "anywhere" }}>
          {error.message || "An unexpected error occurred."} Your session may have expired.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={btnStyle}
          >
            Reload
          </button>
          {this.props.clearSessionPrefix && (
            <button type="button" onClick={this.clearSessionAndReload} style={btnStyle}>
              Clear session &amp; reload
            </button>
          )}
        </div>
      </div>
    );
  }
}

const btnStyle: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 8,
  border: "1px solid var(--line-strong, #3a342c)",
  background: "var(--bg-secondary, #1e1a16)",
  color: "var(--text-primary, #f2f4f7)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
