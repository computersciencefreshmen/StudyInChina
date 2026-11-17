# One programme catalogue with incremental cloud updates

Status: accepted for implementation, 17 November 2026.

The owner requests one Programs experience for existing records and collected admissions information, followed by unattended collection every fifteen minutes and direct publication. Individual university re-verification is not a publication requirement for the collected lane. Source wording, capture time and provenance remain visible facts about each record.

## Display and identity

The public catalogue combines actual captured records with the existing published catalogue before filtering, ordering and pagination. Sitemap links without captured facts are discovery targets, not empty programme cards. A shared view model preserves existing identifiers and facts. Exact full school name, programme name, known degree and teaching language permit a duplicate match; uncertain identities stay separate. Existing reviewed records win an exact duplicate, and collected sources remain additional provenance.

Canonical list and detail URLs live under `/programs`. Older imported URLs redirect there. Source attribution is a record attribute rather than a separate catalogue or navigation category.

## Incremental publication

The first release uses the existing captured batch behind a stable asynchronous feed interface. The next stage will use a dedicated GitHub data branch, a hash-bound manifest, small immutable index shards and per-record detail objects. A cloud GitHub Actions schedule collects and checkpoints bounded batches every fifteen minutes. The website can consume a new validated data revision without rebuilding the application for every batch. This reuses existing hosting and repository permissions and does not depend on the owner's computer staying on.

Code releases still use the existing protected CI and production writer. Data batches validate structure, identity, source bindings and hashes; they do not claim university-by-university factual verification. Failed collection retains the previous public snapshot. Host throttling, unavailable links and incomplete extraction are durable retry states rather than successful additions.

## Trade-offs

An independent data branch avoids a single growing JSON bundle and repeated application builds. Small content-addressed shards keep cache entries bounded and detail loading lazy. The initial local snapshot remains a fallback during network or feed failures. GitHub scheduling is best effort rather than an exact wall-clock guarantee; each run is bounded and resumable. A database-backed index remains an option if traffic or catalogue size outgrows the cached snapshot approach.
