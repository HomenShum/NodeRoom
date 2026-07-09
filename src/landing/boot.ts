const privateRoutePattern = /(?:[?&](?:room|demo|create)=|#(?:mobile|\/?mobile|rooms\/|\/?rooms\/|btb|\/?btb|hackwithbay|\/?hackwithbay|upscalex|\/?upscalex|frontier|\/?frontier|room-tour|\/?room-tour|story|\/?story))/i;
const appSearchPattern = /(?:[?&](?:mode|surface|room|demo|create)=)/i;
const appHashPattern = /^#(?:mobile|\/?mobile|rooms\/|\/?rooms\/|btb|\/?btb|hackwithbay|\/?hackwithbay|upscalex|\/?upscalex|frontier|\/?frontier|room-tour|\/?room-tour|story|\/?story)/i;

const routeText = window.location.search + window.location.hash;
const privateRoute = privateRoutePattern.test(routeText);

if (privateRoute) {
  document.documentElement.setAttribute("data-app-route", "private");
  const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]') ?? document.createElement("meta");
  robots.setAttribute("name", "robots");
  robots.setAttribute("content", "noindex,nofollow");
  if (!robots.parentElement) document.head.appendChild(robots);
}

let started = false;

function start(): void {
  if (started) return;
  started = true;
  void import("../app/main");
}

const appSearch = appSearchPattern.test(window.location.search);
const appHash = appHashPattern.test(window.location.hash);

if (privateRoute || appSearch || appHash) {
  start();
} else {
  for (const eventName of ["pointerdown", "keydown", "touchstart", "wheel", "scroll"]) {
    window.addEventListener(eventName, start, { once: true, passive: true });
  }
}
