import { createRoot } from "react-dom/client";
import { NodeAgentWorkspace } from "@homenshum/nodeagent-engines/react";
import "@homenshum/nodeagent-engines/react/styles.css";

createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100vh" }}>
    <NodeAgentWorkspace apiBase="/agent-api" title="Agent Workspace" />
  </div>,
);
