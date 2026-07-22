# Vendored `@nodekit/gym-core`

This directory contains the exact publish-shaped tarball consumed by NodeRoom.
`release-lock.json` binds its version, SHA-256, npm SHA-512 integrity, dependency
specifier, and producer package metadata. `package.json` and `package-lock.json`
must point to this tarball; workspace links and mutable registry tags are not a
portability proof.

The artifact is produced with `npm pack` from NodeSlide's
`packages/gym-core`. Cross-repository CI stages those exact candidate bytes with
`npm run nodegym:candidate:stage -- --tarball <tgz> --producer-package-json
<NodeSlide package.json>`, then runs `npm ci --ignore-scripts` and
`npm run nodegym:consumer:proof`. The stage prepares the vendored artifact,
release lock, package pin, and lockfile integrity as one identity; `npm ci` and
the direct proof fail closed on any byte, lock, export, or governance mismatch.
