# Performance QA Report

Generated: 2026-07-08T08:13:49.879Z
Base URL: `http://127.0.0.1:5262`

> This is a Playwright lab check for Core Web Vitals-style budgets. Use Lighthouse or field data for final production claims.

## Budgets

- LCP good threshold: <= 2500ms
- CLS good threshold: < 0.1
- Load event lab budget: <= 3500ms

## Routes

| Route | Status | HTTP | FCP | LCP | CLS | Load | Transfer | Findings |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `/brand/noderoom/` | pass | 200 | 184ms | 184ms | 0.016 | 188ms | 326 KB | none |
| `/solutions/` | pass | 200 | 36ms | 36ms | 0.016 | 31ms | 326 KB | none |
| `/solutions/collaborative-ai-workspace/` | pass | 200 | 52ms | 52ms | 0.016 | 19ms | 326 KB | none |
| `/solutions/ai-agent-collaboration/` | pass | 200 | 40ms | 40ms | 0.016 | 34ms | 326 KB | none |
| `/solutions/source-backed-ai-workflows/` | pass | 200 | 36ms | 36ms | 0.016 | 13ms | 326 KB | none |
| `/solutions/ai-diligence-room/` | pass | 200 | 40ms | 40ms | 0.016 | 16ms | 326 KB | none |
| `/solutions/ai-research-workspace/` | pass | 200 | 48ms | 48ms | 0.016 | 18ms | 326 KB | none |

## Lighthouse

Run this against a built preview or production URL when Lighthouse CLI/Chrome are available:

```bash
npx --yes lighthouse@latest http://127.0.0.1:5260/ --output=json --output=html --output-path=docs/seo/lighthouse-root --chrome-flags="--headless=new --no-sandbox"
```
