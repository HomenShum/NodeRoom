import { PersistentTextStreaming } from "@convex-dev/persistent-text-streaming";
import { components } from "./_generated/api";

/** Lightweight component binding shared by HTTP streaming and terminal jobs. */
export const streamingComponent = new PersistentTextStreaming(components.persistentTextStreaming);
