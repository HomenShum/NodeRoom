# Hybrid Retrieval Skill

Retrieval is a tool loop, not one vector lookup.

Order:
1. Check current room surface and recent context.
2. Search OKF by semantic meaning and exact text.
3. Filter by metadata: type, tags, status, confidence, timestamp, and visibility.
4. Search spreadsheet structure and then confirm current values with `read_range`.
5. Open literal source evidence before strong claims.
6. Use external search only when local/OKF evidence is missing, stale, or the user asks for fresh research.
7. Stop only when evidence sufficiency is met.

Write rule:
- Search results find candidates.
- Literal reads confirm sources.
- `read_range` confirms current cell values and versions.
- Managed CAS/proposal tools commit or draft changes.

