/** Honest stand-in for live-only routes when this build has no Convex backend (VITE_CONVEX_URL unset). No room, no agent, no sample data. */
export function SetupRequired({ surface }: { surface: string }) {
  return (
    <main data-testid="setup-required" style={{ padding: 24, fontFamily: "var(--font-ui)", color: "var(--text-primary)", background: "var(--bg-primary)", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>{surface} needs the live backend</h1>
      <p style={{ margin: 0, color: "var(--text-muted)" }}>Live backend not configured: set VITE_CONVEX_URL and rebuild.</p>
    </main>
  );
}
