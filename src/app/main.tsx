import React from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App } from "../ui/App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const client = url ? new ConvexReactClient(url) : null;

if (client && import.meta.env.DEV) {
  (window as unknown as { __convexClient?: unknown }).__convexClient = client;
}

const el = document.getElementById("root");
if (el) {
  const app = <App />;
  createRoot(el).render(
    <React.StrictMode>
      <ErrorBoundary clearSessionPrefix="noderoom:">
        {client ? <ConvexProvider client={client}>{app}</ConvexProvider> : app}
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
