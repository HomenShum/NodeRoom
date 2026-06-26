# Gemini Media Judge

Generated: 2026-06-26T02:16:56.109Z
Model: `gemini-3.5-flash`
Run id: `btb-full-20260626-retry-nonbc55`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 9
- Judged: 9
- Errors: 0
- Verdicts: publish=8, fix-then-publish=1
- Defects: P2=5

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `test-results/bankertoolbench/matrix/205a3cb3-33b8-42ea-b50c-fe2dc1630208/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 8/16 | 0/0/1 | The video demonstrates a complete end-to-end execution of the BankerToolBench benchmark, showing file uploads, agent invocation, real-time tool execution traces, and the final generation of financial artifacts. |
| `test-results/bankertoolbench/matrix/5d72295c-f640-4c78-b85a-6f338e46c02b/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 8/16 | 0/0/0 | The video demonstrates a complete end-to-end run of the BankerToolBench package verifier, showing room creation, file uploads, agent execution, and artifact generation. |
| `test-results/bankertoolbench/matrix/963978db-b155-4fe2-9ae7-ca0b259a5fba/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 11.4/16 | 0/0/0 | The video successfully demonstrates a complete end-to-end workflow where a user uploads financial documents and invokes NodeAgent to generate a comprehensive valuation model and presentation deck, complete with visible execution traces. |
| `test-results/bankertoolbench/matrix/9ed5fdf8-7ffa-4c26-92d8-e1f28308af52/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 8/16 | 0/0/0 | Excellent live browser proof showing a complete end-to-end run of the BankerToolBench benchmark. It demonstrates room creation, uploading multiple financial datasets, agent invocation with detailed tool execution traces, and the successful generation and inspection of multiple output artifacts. |
| `test-results/bankertoolbench/matrix/b486dc21-d67e-4857-b2f9-b78c0e0222ce/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 8/16 | 0/0/0 | The video demonstrates a complete end-to-end workflow in NodeRoom, starting from an empty room, uploading multiple financial data files, invoking the NodeAgent with a detailed valuation task, and successfully generating structured artifacts including spreadsheets, presentations, and a PDF report. |
| `test-results/bankertoolbench/matrix/bd2aa5d6-30cd-4b6f-875a-2c3626f56441/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 8/16 | 0/0/1 | An end-to-end benchmark run showing bulk financial data uploads, agent execution with real-time tool traces, and final PDF artifact generation. |
| `test-results/bankertoolbench/matrix/c1c36cfd-677b-462b-96d4-ea76e12e98e8/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 8/16 | 0/0/1 | Excellent benchmark run demonstrating the complete workflow of uploading financial documents and using NodeAgent to generate structured deliverables. |
| `test-results/bankertoolbench/matrix/cc4c8473-4c54-4fdd-9af8-c55bc9e4b07d/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 8/16 | 0/0/0 | The video demonstrates a complete end-to-end financial analyst workflow where an agent processes uploaded spreadsheets and documents to generate valuation models, presentations, and memos. |
| `test-results/bankertoolbench/matrix/df4c5a14-a6f9-4a56-ac8a-ad2562b50a7e/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | fix-then-publish | 8/16 | 0/0/2 | The video demonstrates a complete end-to-end workflow of uploading financial documents, invoking the NodeAgent with a complex analysis task, and reviewing the generated multi-artifact deliverables. |

## Open Defects

- **P2** `test-results/bankertoolbench/matrix/205a3cb3-33b8-42ea-b50c-fe2dc1630208/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 01:30: The trace log text is highly dense and small, making it difficult to read at standard video resolutions. -> Consider adding a toggle to expand or zoom the trace panel for better readability during execution.
- **P2** `test-results/bankertoolbench/matrix/bd2aa5d6-30cd-4b6f-875a-2c3626f56441/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 00:30: Sidebar becomes highly cluttered with a long list of uploaded files. -> Implement collapsible groups or pagination for uploaded files in the sidebar.
- **P2** `test-results/bankertoolbench/matrix/c1c36cfd-677b-462b-96d4-ea76e12e98e8/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 02:07: High density of files in the sidebar causes some filename truncation. -> Adjust sidebar width or implement tooltips for long filenames.
- **P2** `test-results/bankertoolbench/matrix/df4c5a14-a6f9-4a56-ac8a-ad2562b50a7e/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 01:48: A strange visual overlay/glitch showing food/beverage items briefly corrupts the video frame. -> Re-encode or re-record the video to eliminate the frame corruption.
- **P2** `test-results/bankertoolbench/matrix/df4c5a14-a6f9-4a56-ac8a-ad2562b50a7e/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 01:51: Another brief visual glitch/overlay appears over the document preview. -> Ensure clean video capture without frame artifacts.

## Re-run

```bash
npm run media:gemini-judge -- --run-id btb-full-20260626-retry-nonbc55 --out "docs\\eval\\gemini-media-judges\\btb-full-20260626\\retry-nonbc55" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\205a3cb3-33b8-42ea-b50c-fe2dc1630208\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\5d72295c-f640-4c78-b85a-6f338e46c02b\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\963978db-b155-4fe2-9ae7-ca0b259a5fba\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\9ed5fdf8-7ffa-4c26-92d8-e1f28308af52\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\b486dc21-d67e-4857-b2f9-b78c0e0222ce\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\bd2aa5d6-30cd-4b6f-875a-2c3626f56441\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\c1c36cfd-677b-462b-96d4-ea76e12e98e8\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\cc4c8473-4c54-4fdd-9af8-c55bc9e4b07d\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\df4c5a14-a6f9-4a56-ac8a-ad2562b50a7e\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm"
```
