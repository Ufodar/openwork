# Bid QC checklist (gate)

## Compliance
- Every tender requirement has a response location and citation.
- All mandatory forms/tables are present and filled.
- All required attachments/certificates exist and match the tender list.

## Business facts (must match `facts.json`)
- Bid deadline and submission method are correct.
- 工期 / schedule dates are consistent everywhere.
- Warranty/maintenance durations and SLAs are consistent everywhere.
- Legal entity names, IDs, addresses, contacts match source materials.
- Time-sensitive certificates are within validity windows (e.g., 社保证明/纳税证明 dates are not outdated).
- Scoring method and breakdown match the tender document.

## Consistency
- No stray client/company names from older bids.
- People names/titles are consistent (no placeholder left behind).
- Images/logos match the intended company/partner.
- Qualification documents (资质文件) bear the correct company name matching `bidderLegalName`.
- Certificate validity dates have not expired before the bid deadline.
- Full-text search confirms no residual old company names or old project names from historical bids.
- Image filenames and metadata do not contain other company identifiers (warning level).

## Point-to-point completeness
- Every starred (★) requirement in `requirements.csv` has a response in the draft.
- Every must-have requirement has a non-placeholder response.
- No `<<TBD: ...>>` placeholders remain in starred/must items.

## Formatting
- Tender template constraints are met (section order, file naming, signatures/seals).

## Dedupe
- No large verbatim copy blocks from other bids without editing for project specifics.
- No outdated dates or project names inside reused text.
