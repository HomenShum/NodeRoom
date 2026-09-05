# Desktop Account export evidence

A reviewer could read five Account labels in the Q3 grid but receive blank labels in the downloaded workbook. The exporter read `__account` while the existing sheet and renderer used `__label`. Two field lookups now read the existing labels; no grid or transport redesign was needed.

Start with the [repository handoff](../../HANDOFF.md). The [independent source judgment](review/E6f_NODEROOM_DESKTOP_ACCOUNT_FINAL_JUDGE.md.txt) accepts this bounded repair after 22 checks. The [worker receipt](review/E6f_NODEROOM_DESKTOP_ACCOUNT_REPAIR_RECEIPT.md.txt) retains the commands, early failures and final source bindings. Shared CI and integration of this desktop slice are subsequent checks; this packet is not their receipt.

Compare the actual [before grid](operator/before/change-boundary.png) and [after grid](operator/after/change-boundary.png). Both show the five labels. The file defect is demonstrated by the actual XLSX files listed in the [copy map](raw-copy-map.json), then independently reopened through [ZIP/XML inspection](judge/independent-zip-xml.json). Exactly A2:A6 change to the labels; the other 25 values/formulas and all 30 styles, including raw styles.xml, match. Later note exports change E2 while prior files remain byte-exact.

The normal build including root TypeScript, Convex TypeScript, design audit, ten affected scenarios and three unchanged-budget browser cases passed. Restoring only the old lookups makes both label scenarios fail. Both component cases use a typed mocked store plus a replaced browser download-dispatch boundary, while retaining the real Artifact projection and ExcelJS serializer. Only the current canonical sheet has this repair's actual memory-engine browser journey. The sibling fixture is not an uploaded-canonical-workbook browser certificate; the separate existing generic-uploaded-grid case remains a limited compatibility check.

From the repository root, verify portable custody with Python 3 and Git:

```powershell
python evidence/desktop-account-20260905/verify.py
```

The verifier checks every included payload and the four current source identities, accepting Git's declared source line-ending normalization. Packet payloads are binary-attributed and must remain raw-byte exact. It does not execute historical scripts or rerun the app. Replay the application commands in HANDOFF.md after the normal fresh installation and built-preview setup there.

The [original inventory](original-inventory.json) lists all 133 original operator files, including seven large build archives or whole-checkout/index inventories retained only in local custody. Of those 133 files, 126 are included here. All 21 independent judge files and both worker/judge reports are also included. The independent reviewer verified the original retained-only bytes, but a fresh recipient cannot verify unavailable local archives; this verifier explicitly reports that boundary. Historical code, HTML and Markdown have inert `.txt` suffixes. Absolute paths inside historical receipts identify original custody, not portable commands.

Evidence covers the local memory engine and bounded repeated exports, not a long-duration or multi-user load certificate. Actual matched workbooks have scalar values/strings; formula/cache/number-format behavior is covered by the component fixtures. Fallback fonts and one desktop width limit visual conclusions. One blocked external-resource console event is preserved; no zero-console claim. The base build stamp identifies merged 034a8f9, supplemented by exact uncommitted source bindings. Existing notebook failures, Windows native Excel timeout, missing nightly credential and development advisory remain open. No native Office, provider, production workbook journey, whole-product grade or human acceptance is claimed.
