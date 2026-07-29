# ExcelJS dependency hardening

## Decision

Keep the public `exceljs@4.4.0` API and harden its two ZIP dependency paths
without changing the workbook contract:

- `archiver` -> `@excel.js/archiver@0.0.5`
- `unzipper` -> official `unzipper@0.10.14`
- `unzipper -> fstream` -> NodeRoom's local
  `fstream@1.0.12+noderoom.fail-closed.1` compatibility package

The archive writer is the narrow, ExcelJS-compatible package published from
[`excel-js/excel-js`](https://github.com/excel-js/excel-js). The reader stays on
the exact parser version ExcelJS 4.4.0 already used because its entry ordering is
part of ExcelJS's shared-string streaming behavior. ExcelJS only invokes
`unzipper.Parse({ forceStream: true })`; it never invokes `Extract` or `Open`,
which are the `fstream`-backed extraction APIs. The local compatibility package
therefore throws on every `fstream` operation. If a future code path attempts
extraction, it fails closed instead of silently reintroducing filesystem writes.

The direct `unzipper` and local `fstream` dependency entries are deterministic
anchors for npm's `$dependency` override syntax. The package lock records the
exact writer tarball integrity and the explicitly NodeRoom-owned build identity
for the local compatibility boundary. Build metadata keeps the
identity visibly local while satisfying `unzipper`'s `^1.0.12` compatibility
range; a prerelease suffix would fall outside that range and make `npm ci`
resolve the vulnerable upstream package again.

## Root cause

The July 2026 `brace-expansion` denial-of-service advisory affected every
release through `5.0.7`. ExcelJS 4.4.0 reached vulnerable legacy releases over
two independent production paths:

```text
exceljs -> archiver -> archiver-utils/readdir-glob -> glob/minimatch -> brace-expansion
exceljs -> unzipper -> fstream -> rimraf -> glob/minimatch -> brace-expansion
```

The same release gate also found three critical Auth.js advisories because the
application pinned `@auth/core@0.41.1`; the patched compatible version is
`0.41.3`. NodeRoom's custom email-provider normalizer also validated before
Unicode canonicalization, so it now applies bounded NFKC normalization before
checking the one-`@` address shape. This closes the application-specific form of
the Auth.js homoglyph advisory instead of relying on the dependency bump alone.

The clean-lock verification also surfaced newer high-severity advisories in the
development graph. The lock now selects `fast-uri@3.1.4`,
`postcss@8.5.24`, and its compatible `nanoid@3.3.16` transitive without changing
the declared dependency ranges.

## Alternatives rejected

- `npm audit fix --force` proposed downgrading ExcelJS to 4.1.1 and did not
  provide a compatibility argument.
- Overriding only `brace-expansion` is unsafe because legacy Minimatch expects a
  callable CommonJS export, while patched brace-expansion 5 exposes `expand` as
  a named export.
- Overriding ExcelJS to `archiver@8` is not compatible: ExcelJS expects a
  callable CommonJS factory and passes its legacy `StreamBuf`, which Archiver 8
  rejects.
- Upgrading to `unzipper@0.12` can reorder ZIP entries in the streaming reader
  and break shared-string caching.
- The initially evaluated `@excel.js/unzipper@0.0.2` preserves the API shape but
  provides no reliability advantage. Stress diagnostics reproduced ExcelJS
  4.4's existing short-archive shared-string timing race with the original,
  scoped, and current `0.12` parser implementations. NodeRoom's application
  paths use `Workbook.xlsx.load/readFile`, not `WorkbookReader`, so the gate
  exercises the real application reader concurrently and retains one sustained
  `WorkbookReader` round trip to protect the dependency contract.
- Replacing `fstream` with an implementation that extracts files would preserve
  an unused attack surface. The selected boundary makes the supported parse-only
  contract explicit and rejects extraction.

## Verification

Run:

```powershell
npm ci
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
npm test -- --run tests/authEmailVerification.test.ts
npm test -- --run tests/exceljsDependencyCompatibility.test.ts tests/artifactXlsxExport.test.ts tests/spreadsheetParser.test.ts
npm run floor
npm run prod:gate
```

`tests/exceljsDependencyCompatibility.test.ts` protects the non-obvious
compatibility boundary with a 1,024-row streaming write/read, 16 waves of four
concurrent writers loaded through NodeRoom's application reader, truncated-input
failure, exact package-resolution checks, and a fail-closed extraction
assertion.

## Primary advisories

- [Auth.js malformed Bearer handling](https://github.com/advisories/GHSA-xmf8-cvqr-rfgj)
- [Auth.js email normalization](https://github.com/advisories/GHSA-7rqj-j65f-68wh)
- [Auth.js provider-bound OAuth cookies](https://github.com/advisories/GHSA-x445-f3h2-j279)
- [brace-expansion denial of service](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
- [fast-uri host confusion](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx)
- [fast-uri IDN canonicalization](https://github.com/advisories/GHSA-4c8g-83qw-93j6)
- [PostCSS source-map path traversal](https://github.com/advisories/GHSA-r28c-9q8g-f849)
