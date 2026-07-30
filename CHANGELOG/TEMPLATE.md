# Changelog lane format

Create one append-only file per page, component, server module, database table,
integration, or script. Prepend new entries immediately below the lane heading.
Never rewrite old entries.

```md
## YYYY-MM-DD — Short imperative title

Explain what changed, why, and the user-visible effect in one to three
sentences.

**Commit**: `<7-char sha>`. **Author**: <name>.

**Touches**: `<other CHANGELOG lanes>` (omit when there are none)
```

Use imperative titles, exact commit identifiers, and bidirectional `Touches`
links for changes spanning multiple surfaces.
