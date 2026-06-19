export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

export function getFocusableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter(isUsableFocusable)
    .map((element) => element as HTMLElement);
}

export function focusFirst(root: ParentNode): boolean {
  const first = getFocusableElements(root)[0];
  if (!first) return false;
  first.focus();
  return true;
}

export function keepFocusWithin(container: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== "Tab") return false;
  const focusable = getFocusableElements(container);
  if (!focusable.length) return false;

  const doc = container.ownerDocument;
  const active = doc.activeElement;
  const currentIndex = focusable.findIndex((element) => element === active);
  const nextIndex = event.shiftKey
    ? currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
    : currentIndex === -1 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;

  event.preventDefault();
  focusable[nextIndex]?.focus();
  return true;
}

function isUsableFocusable(element: Element): boolean {
  const html = element as HTMLElement;
  if (html.hidden || html.getAttribute("aria-hidden") === "true") return false;
  if (html.getAttribute("disabled") != null) return false;
  return typeof html.focus === "function";
}
