import { defineApp } from "convex/server";
import workflow from "@convex-dev/workflow/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/convex.config.js";
import debouncer from "@ikhrustalev/convex-debouncer/convex.config.js";

const app = defineApp();

app.use(workflow);
app.use(workpool, { name: "agentWorkpool" });
app.use(persistentTextStreaming);
app.use(debouncer);

export default app;
