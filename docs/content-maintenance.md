# Content maintenance

StudyInChina is useful only when a prospective student can tell **which intake a fact applies to, where it came from, and when it was checked**. Registered official sources are collected automatically. A fact may enter an immutable Catalog Release only after its source authority, evidence, value shape, model agreement, deterministic rules, conflict state, and freshness all pass. Automation never guesses; a rejected field publishes no value and keeps only its status and official entry link.

## Source policy

Use sources in this order:

1. The university's official international admissions or program page.
2. The scholarship provider's official page, such as the China Scholarship Council or the university itself.
3. An official national, provincial, or municipal government page.
4. A current official prospectus or notice published by one of the organizations above.

Aggregators, agency pages, social posts, blogs, cached copies, and search snippets may help locate an official source, but they are not sufficient evidence on their own. When two official pages conflict, keep the published record marked `stale` (or leave the new value unpublished), link both sources in the PR, and request a second review. Never resolve a conflict by choosing the more attractive deadline, fee, or scholarship coverage.

Store the official link in the school's Source Manifest and keep a permanent source ID, snapshot hash, and field evidence. Every time-sensitive record must include:

- the academic year or intake it covers;
- `sourceIds` pointing to the evidence;
- `verifiedAt`, set to the day a maintainer opened and checked the official source;
- `reviewAfter`, set to the next deliberate review date; and
- an honest `status` (`draft`, `verified`, `stale`, or `archived`).

If the new cycle has not been announced, use `null` and `not-announced`. Keep an older cycle as an explicitly labelled historical reference; do not copy its date, fee, requirement, or scholarship terms into the current cycle.

## Automated publication workflow

1. Register only an official HTTPS URL, exact allowed hosts, cadence, source category, parser, and expected fields in a Source Manifest.
2. The Worker checks robots policy and per-domain rate limits, validates redirects, stores an immutable private snapshot, and skips extraction when normalized content is unchanged.
3. Deterministic parsing runs first. Critical fields require two independent MiniMax extractions with grounded evidence and deterministic agreement checks.
4. Passing candidates are promoted into a complete versioned Release; any conflict, low confidence, stale evidence, unavailable source, or failed check becomes a non-`known` field status with a `null` value.
5. The Catalog activation transaction verifies checksums, counts, relationships, gates, and search data before atomically moving the current pointer.
6. Run:

   ```text
   npm run lint
   npm run typecheck
   npm test
   npm run validate:data
   npm run validate:manifests
   npm run validate:d1
   npm run test:ingestion
   npm run check:worker:catalog
   npm run check:worker:ingestion
   npm run build
   ```

7. Inspect the Vercel preview on desktop and mobile. Check field status, official source, checked time, locale formatting, application link, API, search, SEO, JSON-LD, sitemap, and rollback.

Manual corrections remain focused and source-backed, but no human approval is required for candidates that pass the locked automatic publication gates. A correction must update the manifest/parser or add authoritative evidence; it must never edit a generated Catalog value without provenance.

## Translation review

English is the base editorial version. English source text must exist before a record can publish. Chinese and Russian navigation, legal text, and core content require human review for the initial release.

When an official English name or description is unavailable, the system may generate and cache an explicitly labelled reference translation. Prefer an institution's official translation whenever one exists. Facts such as dates, tuition, application fees, duration, and language scores live once in structured data and are formatted with `Intl`; they must not be copied into translated prose.

German, French and Spanish form the first public expansion batch. Their navigation, core interface and legal copy must remain complete; missing record-level prose displays an explicit “Translation pending” English fallback and must never silently fall back to a different language. Arabic and Portuguese remain private preview locales until navigation and legal pages are 100% complete, core content reaches 95% coverage, and Arabic passes an RTL layout review.

## Review cadence

- **Every 3 days:** recheck registered current-cycle sources whose deadline is within 45 days.
- **Every 7 days:** recheck current admission cycles, fees, and scholarship sources.
- **Every 30 days:** check every registered source and rerun catalog/program/scholarship discovery.
- **Every 90 days:** refetch stable university descriptions; their link health is still checked monthly.
- **Publication gate:** a verified program, admission cycle or scholarship may not set `reviewAfter` more than 31 days after `verifiedAt`. The data schema rejects a longer window, so current admissions facts cannot silently skip the monthly review queue.
- **January and August:** scheduled semester audits perform a broader review for spring/autumn intakes and newly published annual scholarship notices.
- **Before each release:** automatically require official evidence coverage, reconciliation, relationship integrity, checksum/count agreement, conflict isolation, and zero leakage of failed fields.

Scheduled jobs and release builds can also be triggered manually. A failed gate leaves the current Release untouched.

## Data Health reports

`scripts/check-links.mjs` scans HTTP(S) values in `content/data/*.json`. It tries `HEAD`, then a ranged small `GET`, with bounded retries and timeouts. `scripts/data-health.mjs` combines that result with `verifiedAt`, `reviewAfter`, deadline, source-reference, and status checks. The workflow updates one open `[Data Health] Content review` issue and uploads the complete machine-readable reports.

The legacy report remains advisory during shadow migration. Once D1 is primary, maintainers correct the manifest, parser, or source mapping and let a new Release reproduce the fact. Workflows and bots must never:

- publish a changed deadline, fee, requirement, scholarship, program, or application link without official field evidence and all gates;
- promote a `draft`, conflicting, unavailable, or stale field to `known`;
- copy a previous cycle into a new cycle; or
- publish machine translations without human review.

If a university site is temporarily unavailable, do not reuse or extend the previous value. Return `source_unavailable` or `stale` with a `null` value and the official entry link until a new snapshot passes validation.
