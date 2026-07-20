# NodeSlide runtime closure

These six publish-shaped `@nodeslide/*` tarballs are the private runtime closure
needed to compile and test NodeRoom's mounted studio and isolated Convex
component. `package-lock.json` pins each file by npm SHA-512 integrity.

This directory is not a public-release receipt and deliberately does not name a
producer commit. The final cross-repository gate must be bound to artifacts
regenerated from merged NodeSlide `main`; pass that release lock explicitly to
`scripts/nodeslide-mounted-release-proof.ts --lock <path>` and require an exact
NodeSlide checkout before recording a bilateral receipt.
