# NodeSlide immutable mounted release

This directory contains the complete publish-shaped `@nodeslide/*` v0.2.0
artifact set generated from merged NodeSlide main commit
`39a9ebfcbaaeef52556bc263d386ea4859f476bb`.

`nodeslide-artifacts.json` binds every tarball to SHA-256 and npm SHA-512
integrity. `install-upgrade-proof.json` records the clean 0.1.0 to 0.2.0
install/upgrade proof, including tamper and mixed-release rejection.
`release-lock.json` binds both receipts and the exact producer commit consumed by
NodeRoom CI. The six runtime tarballs are exact `file:` dependencies in
`package.json` and `package-lock.json`; the remaining packages stay here so the
release proof can verify the complete lockstep set.
