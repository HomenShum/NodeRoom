import { defineApp } from "convex/server";
import workflow from "@convex-dev/workflow/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/convex.config.js";
import debouncer from "@ikhrustalev/convex-debouncer/convex.config.js";
import prosemirrorSync from "@convex-dev/prosemirror-sync/convex.config.js";
import nodeslide from "@nodeslide/convex/convex.config.js";
import nodekitCaseflow from "@homenshum/nodekit/convex.config.js";

const app = defineApp();

app.use(workflow);
// P0: Separate workflow component for passive jobs — its internal workpool
// gets maxParallelism=1 so passive jobs can never starve foreground jobs.
app.use(workflow, { name: "passiveWorkflow" });
app.use(workpool, { name: "agentWorkpool" });
app.use(persistentTextStreaming);
app.use(debouncer);
app.use(prosemirrorSync);
app.use(nodekitCaseflow);
// Isolated package-owned storage surface. NodeRoom's mounted product writes
// remain authoritative in artifacts/elements/proposals; this mount gives
// migrations and independent component consumers their own Convex namespace.
app.use(nodeslide, { name: "nodeslide" });

export default app;
