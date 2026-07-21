# NodeSlide immutable mounted release

This directory contains the complete publish-shaped `@nodeslide/*` v0.2.2
artifact set generated from merged NodeSlide main commit
`a88fb57f111db82e9334d68fa7611a51ed54c3c1` and published as immutable
annotated tag object `ec4870300e1ad7ddd74209aada3a47a26779b4bb`.

`nodeslide-artifacts.json` binds every tarball to SHA-256 and npm SHA-512
integrity. `install-upgrade-proof.json` is the public Actions receipt from run
`29787121559`. It records the clean 0.1.0 to 0.2.2 install/upgrade proof,
including byte-identical candidate rebuild, tamper rejection, and
mixed-release rejection.
`release-lock.json` binds both receipts and the exact producer commit consumed by
NodeRoom CI. The six runtime tarballs are exact `file:` dependencies in
`package.json` and `package-lock.json`; the remaining packages stay here so the
release proof can verify the complete lockstep set.
