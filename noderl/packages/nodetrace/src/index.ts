/** Live-capture pipeline — public surface.
 *  runCapture(observe/act/extract loop) + aiSdkReasoner(provider-agnostic) + pickSubstrate(browser). */
export * from "./types";
export { runCapture } from "./pipeline";
export { aiSdkReasoner } from "./reasoning";
export { CAPTURE_LIMITS, CaptureUrlError, assertCapturableUrl, clipRepresentation } from "./guards";
export { pickSubstrate, browserbaseSubstrate, firecrawlSubstrate } from "./substrate";
