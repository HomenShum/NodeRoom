# Historical Preview Evidence

This directory preserves sanitized metadata from the July 10 authenticated preview. It is not a trusted launch bundle and intentionally fails the strict `launch:proof:verify` generator, policy, commit, freshness, and receipt-binding requirements.

Generate current proof from a clean exact commit:

```bash
npm run launch:gate:ci -- --out .launch/generated/ci
npm run launch:proof:verify -- --bundle .launch/generated/ci --expect-commit <exact-commit>
```

CI packages and attests the generated bundle. Deployment and publication may consume that generated artifact only; they must not consume this historical directory.
