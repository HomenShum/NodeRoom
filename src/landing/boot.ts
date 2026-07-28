const privateRoutePattern = /(?:[?&](?:room|demo|create)=|#(?:mobile|\/?mobile|rooms\/|\/?rooms\/|btb|\/?btb|smb-lending|\/?smb-lending|hackwithbay|\/?hackwithbay|upscalex|\/?upscalex|frontier|\/?frontier|room-tour|\/?room-tour|story|\/?story))/i;
const appSearchPattern = /(?:[?&](?:mode|surface|intent|room|demo|create)=)/i;
const appHashPattern = /^#(?:mobile|\/?mobile|rooms\/|\/?rooms\/|btb|\/?btb|smb-lending|\/?smb-lending|hackwithbay|\/?hackwithbay|upscalex|\/?upscalex|frontier|\/?frontier|room-tour|\/?room-tour|story|\/?story)/i;

const routeText = window.location.search + window.location.hash;
const privateRoute = privateRoutePattern.test(routeText);

if (privateRoute) {
  document.documentElement.setAttribute("data-app-route", "private");
  const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]') ?? document.createElement("meta");
  robots.setAttribute("name", "robots");
  robots.setAttribute("content", "noindex,nofollow");
  if (!robots.parentElement) document.head.appendChild(robots);

  // A room URL can be the first visit or the deliberate reload-recovery proof. Label the
  // static shell before React mounts so the latter is not mistaken for a second create.
  if (/[?&]room=/i.test(window.location.search)) {
    document.querySelector<HTMLElement>(".nr-boot-status strong")?.replaceChildren("Reload recovery");
    document.querySelector<HTMLElement>(".nr-boot-status span")?.replaceChildren("Restoring the live workspace, artifacts, and chat after reload.");
    const activeStep = document.querySelector<HTMLElement>(".nr-boot-step.now");
    if (activeStep) activeStep.innerHTML = "<i></i>Restoring artifacts";
  }
}

// The boot shell lives inside #root, so the ONLY thing that removes it is React
// mounting. That gave "loading" exactly one exit and "failed" none: a rejected
// chunk import (stale hash after a deploy is the common one) left the shimmer
// running under "Opening room" forever — a failure wearing a loading state.
// Declare the state in the DOM so an inspecting agent can read it too.
const BOOT_TIMEOUT_MS = 20_000;

function markBootState(state: "loading" | "failed", detail?: string): void {
  const shell = document.querySelector<HTMLElement>(".nr-ssr-private");
  if (!shell) return;
  shell.setAttribute("data-boot-state", state);
  if (state !== "failed") return;
  shell.setAttribute("aria-label", "NodeRoom workspace did not load");
  shell.querySelector<HTMLElement>(".nr-boot-status strong")?.replaceChildren("Could not open the room");
  shell.querySelector<HTMLElement>(".nr-boot-status span")?.replaceChildren(
    detail ?? "The workspace did not finish loading. Reload to try again.",
  );
  // The step rail claims progress that is no longer happening.
  shell.querySelector<HTMLElement>(".nr-boot-progress")?.remove();

  // Telling someone to reload without giving them a control is a half-finished
  // state. One button, no motion — this sits on a surface where trust is decided.
  const status = shell.querySelector<HTMLElement>(".nr-boot-status");
  if (status && !status.querySelector(".nr-boot-retry")) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "nr-boot-retry";
    retry.textContent = "Reload";
    retry.addEventListener("click", () => window.location.reload());
    status.appendChild(retry);
  }
}

let started = false;

function start(): void {
  if (started) return;
  started = true;
  markBootState("loading");

  let settled = false;
  const timer = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    // A hung import never rejects, so a catch alone cannot cover this.
    markBootState("failed", "The workspace took too long to load. Reload to try again.");
  }, BOOT_TIMEOUT_MS);

  import("../app/main").then(
    () => {
      settled = true;
      window.clearTimeout(timer);
    },
    (error: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      started = false; // allow a retry without a full reload
      console.error("[boot] workspace module failed to load", error);
      markBootState("failed");
    },
  );
}

const appSearch = appSearchPattern.test(window.location.search);
const appHash = appHashPattern.test(window.location.hash);

if (privateRoute || appSearch || appHash) {
  start();
} else {
  for (const eventName of ["pointerdown", "keydown", "touchstart", "wheel", "scroll"]) {
    window.addEventListener(eventName, (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("a[href]")) return;
      start();
    }, { once: true, passive: true });
  }
}
