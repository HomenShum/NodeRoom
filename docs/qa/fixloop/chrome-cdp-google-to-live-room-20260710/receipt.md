# Chrome CDP Google-to-Live-Room Receipt

- Run time: 2026-07-10T03:48:10-07:00
- Browser surface: user Chrome via Chrome CDP
- Google query: `noderoom`
- Browser identity: signed-in Google profile was visible as `hshum2018@gmail.com`
- Clean signed-out profile gate: **not satisfied by this run**

## Discovery

- Google showed `NodeRoom - live collaborative AI rooms with NodeAgents` at `https://noderoom.live/` as the top visible NodeRoom result.
- The visible snippet described NodeRoom as a live collaborative AI room for shared files, spreadsheets, notes, traces, and NodeAgents.
- The search result was relevant and did not point at a private room route.

## Public Surface

- Root URL: `https://noderoom.live/`
- Title: `NodeRoom - live collaborative AI rooms with NodeAgents`
- H1: `Diligence that shows its work.`
- Robots: `index,follow`
- Canonical: `https://noderoom.live/`
- Primary CTA reached the real create route and created a live Convex room.
- Brand page: `https://noderoom.live/brand/noderoom/`
- Brand page title: `NodeRoom - official collaborative AI room app`
- Brand page H1: `NodeRoom is the collaborative AI room app.`
- Brand page canonical matched its public URL; no robots meta was present, so it remains indexable by default.
- Public copy contained both `NodeRoom` and `NodeAgents` with the intended roles.

## Live Room

- Room code: `NRU137A3XJH`
- Route: `https://noderoom.live/?room=NRU137A3XJH&name=Host`
- Route was not `mode=memory`.
- Live Convex indicator was visible.
- Chat smoke posted and remained visible after reload: `Google-to-live-room smoke from Chrome`.
- Q3 variance artifact was present and the artifact export control was present and clickable.
- Reload recovery preserved the room code, live indicator, Q3 artifact, and chat smoke.
- Private room route returned `noindex,nofollow` with the public root canonical.

## Safety And Limits

- No NodeRoom application console errors were observed.
- The only warnings exposed by Chrome were from unrelated installed extensions (`chrome-extension://...`), not the NodeRoom page.
- The Chrome bridge did not expose a download event for this manual XLSX click, so this run does not replace the byte-level workbook proof in the final Playwright receipt.
- Existing byte-level export proof remains at `docs/seo/journey-artifacts/google-to-live-room-dogfood-20260709-final-proof/downloads/q3-variance-export.xlsx` and is recorded in the final fix-loop receipt.
- This run does not clear the clean signed-out Google requirement. Earlier fresh-profile runs from the same network returned Google's `/sorry/` unusual-traffic page for all discovery queries.

## Result

The signed-in Chrome search-to-live-room product path passed. The overall goal remains blocked only on the external clean signed-out Google SERP condition and the optional Search Console API credential lane; no new NodeRoom product defect was found.
