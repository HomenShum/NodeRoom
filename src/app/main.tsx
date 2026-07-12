import React from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { App } from "../ui/App";
import { ErrorBoundary } from "./ErrorBoundary";
import { launchAuthRequired } from "../auth/launchAuth";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const client = url ? new ConvexReactClient(url) : null;
const appCommit = (import.meta.env.VITE_APP_COMMIT as string | undefined)?.trim();
const backendRevision = (import.meta.env.VITE_BACKEND_REVISION as string | undefined)?.trim();

if (appCommit) document.documentElement.dataset.appCommit = appCommit;
if (backendRevision) document.documentElement.dataset.backendRevision = backendRevision;
if (url) {
  try {
    document.documentElement.dataset.convexDeployment = new URL(url).hostname.split(".")[0];
  } catch {
    // ConvexReactClient reports the invalid URL below; do not invent a deployment coordinate.
  }
}

if (client && import.meta.env.DEV) {
  (window as unknown as { __convexClient?: unknown }).__convexClient = client;
}

const el = document.getElementById("root");
if (el) {
  void loadAppStyles().then(() => {
    const app = <App />;
    createRoot(el).render(
      <React.StrictMode>
        <ErrorBoundary clearSessionPrefix="noderoom:">
          {client
            ? launchAuthRequired()
              ? <ConvexAuthProvider client={client}>{app}</ConvexAuthProvider>
              : <ConvexProvider client={client}>{app}</ConvexProvider>
            : app}
        </ErrorBoundary>
      </React.StrictMode>,
    );
  });
}

async function loadAppStyles(): Promise<void> {
  await import("../ui/tokens.css");
  await import("./styles.css");
  await import("../ui/primitives/primitives.css");
}
