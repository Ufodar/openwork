---
name: doc-normalize
description: Scan the current document for normalization issues and suggest next steps
---

Use the `doc-normalize` skill and follow it strictly.

Arguments: `$ARGUMENTS`
- Treat arguments as scan scope or constraints, not permission to modify the document.
- Keep the first execution scan-only.
- Return a concise report with high-confidence findings, risky items, and suggested next natural-language follow-up.
- Do not modify the target document in v1.
