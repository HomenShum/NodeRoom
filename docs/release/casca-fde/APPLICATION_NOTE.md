# Casca FDE application note

Casca's current Forward Deployed Engineer role describes a roughly 70% building and
shipping / 30% embedded-customer split. The role centers on living in bank workflows,
turning that understanding into production software, owning the lifecycle, and feeding
field learning back into the platform. Source:
https://jobs.ashbyhq.com/casca/577560f5-e509-4ffe-9ff0-cbf71b64e954

## Paste-ready note

I am a former JPMorgan commercial credit analyst and healthcare, life-science, and
startup banker who became the AI product engineer building the systems I needed as an
operator.

Casca's Forward Deployed Engineer role is compelling because it joins those two halves
directly: embed with underwriters, lenders, and operators; reconstruct the real workflow;
ship production software; and turn field discoveries into reusable platform capability.

To demonstrate that loop, I built an independent, synthetic SMB Lending Deployment Room
inside NodeRoom. The production workflow uses version-pinned proposals, two explicit
human approvals, source and digest lineage, CAS-protected application state, a
decision-free human-review packet, and export/reopen proof. It does not make a credit
decision.

The most useful result came from the first production attempt: the page and deployments
looked healthy, but the served frontend and reviewed backend were bound to different
Convex targets. The browser journey exposed the split. I corrected the production
binding, redeployed the exact clean commit, and repeated the workflow through verified
evidence, packet regeneration, export, reopen, and reload persistence.

That is the kind of work I want to do at Casca: enter one bank deeply, focus on the
highest-value operational bottleneck, ship the bounded solution, and bring the proven
primitive and the real failure modes back into the platform.

Proof package: `docs/release/casca-fde/`

Live product: https://noderoom.live

Independent project; not affiliated with or endorsed by Casca. Synthetic data only.

