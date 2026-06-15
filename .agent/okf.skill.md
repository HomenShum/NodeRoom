# OKF Retrieval Skill

Use Open Knowledge Format as portable room memory.

Policy:
- Start with local room state, then OKF, then spreadsheet/source/trace lookup.
- Use `okf_list_concepts` or `okf_semantic_search` to discover relevant concepts.
- Use `okf_filter` to narrow by type, tag, status, visibility, confidence, and timestamp.
- Use `okf_backlinks` or `okf_expand_neighbors` when a user asks what depends on a source, metric, chart, or cell.
- Use `source_open_literal` or `source_resolve_citation` before presenting a claim as verified.
- If evidence is weak, label the answer `needs_review` instead of making it client-ready.
- Never use private OKF concepts in public output.
- For artifact writes, produce evidence-bearing `CellPayload` values and use managed lock/CAS tools.

