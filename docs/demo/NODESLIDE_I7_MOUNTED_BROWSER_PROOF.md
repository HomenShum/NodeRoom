# NodeSlide I7 mounted browser proof

Captured 2026-07-20 from NodeRoom's keyless deterministic room in a real
Chromium session. The journey enters the demo room, opens Work Artifacts,
creates the collaborative deck artifact, observes the literal
`@nodeslide/react` studio mount, checks keyboard and accessibility semantics,
and exports a valid PPTX package.

Run it against a local NodeRoom server:

```bash
npm run dev -- --host 127.0.0.1 --port 5317 --strictPort
node scripts/capture-nodeslide-mounted-browser-proof.mjs
```

Acceptance evidence:

- [`nodeslide-i7-mounted-browser.receipt.json`](./nodeslide-i7-mounted-browser.receipt.json)
- [`nodeslide-i7-mounted-browser.png`](./nodeslide-i7-mounted-browser.png)
- [`nodeslide-i7-mounted-browser.webm`](./nodeslide-i7-mounted-browser.webm)
- [`nodeslide-i7-mounted-browser.pptx`](./nodeslide-i7-mounted-browser.pptx)

This camera proof observes the mounted product surface in memory mode. The
server validation/CAS, NodeAgent proposal, reload, presenter, adapter parity,
and package integrity portions remain covered by the deterministic mounted
consumer and release proofs already required in NodeRoom CI.
