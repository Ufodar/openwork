# Bid Writer MVP — UI evidence

This folder contains screenshots that demonstrate the Bid Writer MVP flow working end-to-end in OpenWork:

- Materials uploaded into the session reference library (left sidebar).
- A generated bid draft opened in OnlyOffice (center).
- The session chat alongside the target document (right).

Repro (example):

1. Run OpenWork dev stack.
2. Generate/update the draft with `python3 scripts/bid_mvp_autotest.py ...`.
3. Open `http://127.0.0.1:<webPort>/document-writer/<sessionId>` and select the generated `.docx`.

