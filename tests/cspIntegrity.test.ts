import { describe, expect, it } from "vitest";
import {
  auditInlineScriptCsp,
  inlineScriptHashTokens,
} from "../scripts/lib/cspIntegrity";

describe("production CSP integrity", () => {
  it("keeps a release engineer's structured data and private-route guard executable under an exact allowlist", () => {
    const indexHtml = [
      "<html><head>",
      '<script type="application/ld+json">{"name":"NodeRoom"}</script>',
      "<script>document.documentElement.dataset.appRoute = 'private';</script>",
      '<script data-src="release-audit">globalThis.releaseAudit = true;</script>',
      '<script data-note=" src=/not-an-attribute">globalThis.attributeAudit = true;</script>',
      '<script type="importmap">{"imports":{}}</script>',
      '<script type="speculationrules">{"prerender":[]}</script>',
      '<script type="module" src="/src/app/main.tsx"></script>',
      "</head></html>",
    ].join("");
    const expectedHashes = inlineScriptHashTokens(indexHtml);
    expect(expectedHashes).toHaveLength(5);

    expect(auditInlineScriptCsp({
      htmlByFile: {
        "ai-elements-check.html": '<script type="module" src="/src/aiElementsCheck.tsx"></script>',
        "index.html": indexHtml,
      },
      scriptSrcTokens: ["'self'", ...expectedHashes],
    })).toEqual({
      configuredHashes: [...expectedHashes].sort(),
      expectedHashes: [...expectedHashes].sort(),
      findings: [],
    });
  });

  it("blocks a release when an inline route guard changes but its deployment header remains stale", () => {
    const previous = inlineScriptHashTokens("<script>guard('room')</script>")[0];
    const currentHtml = "<script>guard('room', 'demo')</script>";
    const current = inlineScriptHashTokens(currentHtml)[0];

    expect(auditInlineScriptCsp({
      htmlByFile: { "index.html": currentHtml },
      scriptSrcTokens: ["'self'", previous],
    }).findings).toEqual([
      `CSP script-src is missing ${current} for index.html`,
      `CSP script-src contains stale inline-script hash ${previous}`,
    ]);
  });

  it("hashes the browser-normalized script text across LF, CRLF, and lone-CR checkouts", () => {
    const lf = "<script>\nrouteGuard();\n</script>";
    const crlf = lf.replace(/\n/gu, "\r\n");
    const cr = lf.replace(/\n/gu, "\r");

    expect(inlineScriptHashTokens(crlf)).toEqual(inlineScriptHashTokens(lf));
    expect(inlineScriptHashTokens(cr)).toEqual(inlineScriptHashTokens(lf));
  });

  it("rejects an unverified alternative hash algorithm instead of leaving an orphan allowance", () => {
    const html = "<script>routeGuard();</script>";
    const [expected] = inlineScriptHashTokens(html);

    expect(auditInlineScriptCsp({
      htmlByFile: { "index.html": html },
      scriptSrcTokens: ["'self'", expected, "'sha384-bm90LXRoZS1yZWFsLWhhc2g='"],
    }).findings).toEqual([
      "CSP script-src contains unsupported or malformed hash source 'sha384-bm90LXRoZS1yZWFsLWhhc2g='; use exact sha256 allowances",
    ]);
  });
});
