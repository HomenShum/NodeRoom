# NodeKit note-reference demo proof

The 1280×720 product clip exercises the bounded user workflow in memory mode:

1. open the seeded sample room from the deterministic memory harness;
2. open the Capture Notebook workbench;
3. verify quick capture is armed;
4. open reference inspection and verify capture is disarmed while review is active;
5. close inspection and capture an exact founder note;
6. close and reopen the workbench; and
7. verify the exact note remains visible.

Authoritative machine assertions are stored in `receipt.json`. The 2026-07-30
Playwright run targeted a fresh production build through `vite preview` and
completed with one passing scenario, zero console errors, and zero failed
requests. `contact-sheet.png` is a human-inspected visual sampling of that exact
clip.

Gemini media judging was checked again on 2026-07-30, but
`GOOGLE_GENERATIVE_AI_API_KEY` was not available in the process environment.
No Gemini verdict is claimed. The Playwright receipt and human-inspected contact
sheet remain the available evidence.
