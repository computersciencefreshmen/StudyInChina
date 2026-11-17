# Third-party programme directory

This directory contains source-labelled imports from public admissions providers. The owner requested extraction and publication without a separate university verification step on 17 November 2026.

- `directory.json` holds provider school identities and compact programme URL rows. Sitemap labels come from URL slugs; they do not establish programme availability, admission year, degree, language or conditions.
- `details.json` holds text extracted from successfully captured public programme pages, source URL, capture time and raw-body SHA-256. Field selectors and duplicate source quotations remain in the private canonical snapshot, keeping the website bundle smaller. These are third-party claims, not official university verification.
- `manifest.json` distinguishes extracted records from URL-only discoveries. Provider school IDs may overlap across providers and are not a verified unique-university count.

The existing reviewed university/programme ledgers remain independent. Imported records do not change their status or overwrite them. No MiniMax calls are needed for deterministic extraction from these structured pages.

Refresh with:

```text
node scripts/ingestion/import-third-party-programs.mjs <private-harvest-root>
```

For a frozen batch with offline extraction corrections, explicitly select its canonical snapshot:

```text
node scripts/ingestion/import-third-party-programs.mjs <private-harvest-root> content/third-party candidates.final.jsonl
```

The public manifest records the selected snapshot's filename, byte count and SHA-256; it contains no private filesystem path. The original capture log and field-correction ledger remain private.

Private raw HTML, crawler state and network receipts stay outside the public repository. The importer checks evidence hashes and source URL boundaries; these are extraction-integrity checks, not fact verification. It never infers current admission years from scrape times or sitemap update dates.
