# Third-party programme directory

This directory contains source-labelled imports from public admissions providers. The owner requested extraction and publication without a separate university verification step on 17 November 2026.

- `directory.json` holds provider school identities and compact programme URL rows. Sitemap labels come from URL slugs; they do not establish programme availability, admission year, degree, language or conditions.
- `details.json` holds text extracted from successfully captured public programme pages, source selectors, capture time and raw-body SHA-256. These are third-party claims, not official university verification.
- `manifest.json` distinguishes extracted records from URL-only discoveries. Provider school IDs may overlap across providers and are not a verified unique-university count.

The existing reviewed university/programme ledgers remain independent. Imported records do not change their status or overwrite them. No MiniMax calls are needed for deterministic extraction from these structured pages.

Refresh with:

```text
node scripts/ingestion/import-third-party-programs.mjs <private-harvest-root>
```

Private raw HTML, crawler state and network receipts stay outside the public repository. The importer checks evidence hashes and source URL boundaries; these are extraction-integrity checks, not fact verification. It never infers current admission years from scrape times or sitemap update dates.
