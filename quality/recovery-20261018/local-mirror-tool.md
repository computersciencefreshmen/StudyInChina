# Reproducible local catalogue mirror

`scripts/catalog/build-local-mirror.ts` reuses the catalogue's existing legacy-release builder and all numbered migrations in `infra/d1/catalog/migrations`. It writes a new local SQLite database, self-contained normalized SQL, a full compatibility envelope and a completion manifest. It does not import a cloud client or perform any network, credential, deployment or alias operation.

After the approved catalogue batch is applied, run from the repository root with the independently established current public programme count:

```powershell
node --import tsx scripts/catalog/build-local-mirror.ts --expected-public-programs 766 --evaluated-for-date 2026-10-18
```

The command refuses a count mismatch before creating output. The example count is a batch-specific expectation, not an assertion that the batch has already been applied. Future runs must use their own current expectation and date.

Completed files are kept under the ignored `.catalog-build/local-mirrors/<releaseId>/` directory:

- `normalized.sql`: all current numbered schema migrations followed by the normalized release statements; intended only for a new disposable local database.
- `compat-envelope.json`: the complete schema-validated bundle and release metadata. It preserves supplementary material lists, qualifications, complete cycle notes and other fields not projected into normalized tables.
- `catalog.sqlite`: persisted normalized tables, relationships, release metadata and views.
- `manifest.json`: completion marker, exact artifact hashes, migration hashes, runtime versions, row counts, China-calendar JSON public counts and validation results.

A small receipt is written to `quality/catalog-local-mirrors/<releaseId>.receipt.json`. Existing output identities are refused. A directory lacking `manifest.json` is an incomplete attempt, not a qualified mirror; inspect it separately rather than rerunning into it.

Validation reopens persisted facts through SQLite queries: full integrity check, zero foreign-key violations, all six normalized record counts, unchanged numeric duration columns, exact localized duration wording and unchanged reference-tuition status/amount. The file envelope is compared to the complete input bundle, so notes and application materials cannot disappear unnoticed. Tests also restore the emitted SQL into a separate database and verify it independently.

The website still reads JSON. Normalized SQL intentionally does not project every legacy narrative field, and current SQL views have their own date-dependent publication rules. Neither a local mirror nor matching raw counts establishes JSON/D1 public-view parity or authorizes cloud migration. Keep the compatibility envelope beside the database; no R2 object was uploaded by this tool.
