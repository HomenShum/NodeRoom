# NodeKit reference trust policy

NodeRoom accepts an external NodeKit reference receipt only when its complete
observation → rule → candidate → score → authority chain is structurally valid,
digest-closed, owner-bound, and cryptographically authorized by the pinned
NodePlatform trust policy.

## Canonical input

Configure `NODEKIT_REFERENCE_TRUST_POLICY_JSON` on the Convex deployment with the
exact raw bytes of NodePlatform's reviewed `reference/trust-policy.json`.
Whitespace and trailing newlines are part of the pinned bytes. Reformatting the
JSON changes its SHA-256 digest and must fail closed.

The policy schema is:

```json
{
  "schemaVersion": "nodekit.reference-trust-policy/v1",
  "credentials": {
    "<key-id>": {
      "publicKey": "-----BEGIN PUBLIC KEY-----\n<Ed25519 SPKI>\n-----END PUBLIC KEY-----",
      "algorithm": "Ed25519",
      "assurance": "S2",
      "purposes": ["mobbin-external-reference-run"],
      "producers": ["<tool>@<version>"]
    }
  }
}
```

The policy is public-key material, not a private secret. Keep it server-side so
browser code cannot substitute the authority set used by persistence.

## Acceptance gates

`convex/artifacts.ts` persists the receipt only when all of these are true:

1. The note, room, and actor proof resolve to the same owner.
2. The artifact is a note and the request wins its compare-and-swap boundary.
3. Every referenced payload digest and the canonical receipt digest match.
4. The configured policy is at most 64 KiB and contains at most 128 credentials.
5. The receipt pins `reference/trust-policy.json` and its SHA-256 digest equals
   the digest of the exact configured bytes.
6. The credential is Ed25519, assurance `S2` or `S3`, permits
   `mobbin-external-reference-run`, and names the exact `<tool>@<version>`.
7. The signed run lasts no more than seven days, is not expired, and its signing
   timestamp is within the allowed clock skew.
8. The base64url signature is canonical and verifies the
   `NODEKIT_REFERENCE_SERVICE_ATTESTATION_V1` signing statement.

Any failure returns `invalid_reference_authority`; it never creates a partial
reference chain or a successful status.

## Rotation and deployment

1. Review and merge the NodePlatform policy change first.
2. Copy the file bytes without pretty-printing or line-ending conversion.
3. Compute SHA-256 locally and compare it with the receipt producer's pinned
   policy digest.
4. Update `NODEKIT_REFERENCE_TRUST_POLICY_JSON` on the target Convex deployment.
5. Use the repository's guarded deploy flow only after the NodeRoom PR is
   reviewed and merged. Never deploy the shared Convex schema out of band.
6. Run the valid-receipt, policy-byte-drift, invalid-signature, expiry, owner,
   and concurrent-CAS scenarios.
7. Verify a production receipt through the external NodeProof verifier before
   treating the reference chain as trusted.

For key rotation, publish the new credential alongside the old credential,
deploy the policy, move producers to the new key, verify live receipts, and only
then remove the old credential in a second reviewed policy revision.
