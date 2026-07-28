/**
 * Playwright is a PEER of these gates, never a dependency of the platform.
 *
 * NodeKit core ships dependency-free — that is the whole claim, and it is the same split the
 * motion ladder draws: the platform owns the grammar and the gate, the consuming application owns
 * the runtime that executes it. A UI gate that drags a browser engine into the platform's
 * dependency tree has traded the claim for a bundle.
 *
 * So these scripts resolve `playwright` at run time from the CONSUMER's tree.
 *
 * The important half is the failure mode. A missing browser must fail CLOSED and loudly. The
 * tempting alternative — skip the check, report nothing, exit 0 — is precisely the vacuous pass
 * (docs/VACUOUS_PASS.md): a green result from an instrument that measured nothing. "No browser, so
 * no findings, so PASS" is the exact shape this repository spent a day cataloguing.
 */

import { existsSync } from "node:fs";

export async function requireChromium(toolName) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    throw new Error(
      [
        `${toolName} requires Playwright, which NodeKit deliberately does not depend on.`,
        "",
        "  Install it in the repository being audited, not in the platform:",
        "      npm install --save-dev playwright && npx playwright install chromium",
        "",
        "  This exits non-zero rather than skipping. A gate that cannot reach a browser has",
        "  NOT RUN, and not-run is never a pass.",
      ].join("\n"),
    );
  }

  // The module resolving is not the capability existing.
  //
  // `npm install playwright` WITHOUT `npx playwright install chromium` is the common half-install:
  // the import succeeds, this function returns happily, and the run dies much later at
  // `chromium.launch()` with "Executable doesn't exist at ...". Still non-zero, so not a vacuous
  // pass — but it fails in the wrong place with the wrong message, and the guard would have
  // measured the PACKAGE rather than the BROWSER.
  //
  // This is the guard-shaped member of the class in docs/VACUOUS_PASS.md: a precondition check
  // that verifies a PROXY for the precondition. Module presence standing in for browser
  // availability is the same substitution as prose standing in for a declared trust state.
  //
  // `executablePath()` is synchronous and launches nothing, so proving the real thing is cheap.
  const executable = chromium.executablePath?.();
  if (executable && !existsSync(executable)) {
    throw new Error(
      [
        `${toolName}: Playwright is installed but its Chromium binary is not.`,
        "",
        "      npx playwright install chromium",
        "",
        `  Expected at: ${executable}`,
        "  Not-run is never a pass, so this exits non-zero rather than skipping.",
      ].join("\n"),
    );
  }
  return chromium;
}
