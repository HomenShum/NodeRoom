# LinkedIn build-in-public draft

I built the deployment room I would have wanted as a banker.

Before becoming an AI product engineer, I worked in JPMorgan commercial credit,
healthcare and life-science banking, and startup banking. The workflow was never just
"upload documents and get an answer." It was document state, missing evidence,
calculations, exceptions, handoffs, human authority, and whether the final packet could
survive review.

So I built a synthetic SMB Lending Deployment Room inside NodeRoom as an independent
proof of work for a forward-deployed engineering role.

The production journey now proves:

- two sequential, version-pinned proposals;
- explicit human approval at both material transitions;
- source identifiers, locators, and immutable digests;
- CAS-protected application state;
- a decision-free human-review packet;
- export and independent reopen of both output hashes;
- the same receipt after reload.

The best part: the first production run failed.

The page looked healthy, but the served frontend and reviewed backend were bound to
different deployments. Browser proof caught what health checks missed. I corrected the
binding, redeployed the exact clean commit, and reran the user journey to PASS.

That is the FDE flywheel I care about:

live in the workflow → ship the bounded solution → prove the user path → feed the real
failure and the reusable primitive back into the platform.

The editable deck, 45-second walkthrough, claims ledger, benchmark receipts, and open
limitations are in the public proof package.

Independent project; synthetic data only; not affiliated with or endorsed by Casca.

What would you test next: actual-byte document upload, a bank connector, or a bounded
Neo4j read projection?

