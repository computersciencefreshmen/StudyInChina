# Official dependency materializer

`scripts/ingestion/materialize-official-dependencies.ts` is the only
canonicalizer for the ten organization and location prerequisites used by the
first 1,070 official catalog identities.

It consumes the passed `studyinchina.priority-official-harvest` v2 run
manifest. It does not crawl, call an AI model, create an institution, or create
a city. Its only accepted dependency set is:

- Tsinghua, Peking, Zhejiang, Fudan, Shanghai Jiao Tong, and the University of
  Science and Technology of China;
- Beijing, Shanghai, Hangzhou, and Hefei.

Its output is limited to idempotent business/evidence SQL and a declarative
manifest. It never writes `materialization_batches`,
`materialization_batch_record_intents`, `materialization_batch_records`,
`materialization_batch_chunks`, or
`materialization_batch_source_artifacts`, and it never changes
`records.workflow_status`. Record mappings and source artifacts in the manifest
are declarations for the strict importer, not persisted batch state.

## Fail-closed contract

Generation stops unless all ten dependency source runs are verified and each
has exactly one matching live raw HTML artifact. For every artifact the
canonicalizer checks:

- the exact registered source ID, HTTPS URL, hostname, default port, and role;
- `isFixture: false`, a successful HTTP status, HTML content type, and the
  shared run timestamp;
- a safe relative local path, regular non-symlink file, byte length, SHA-256,
  and deterministic private R2 key;
- equality between the source-run artifact and `dependencyArtifacts`;
- the expected English university or city name in normalized visible HTML
  text.

`--remote-contract` additionally rejects any local test/fixture path. Without
all ten live artifacts, no materialization output is produced.

The generated SQL then verifies the existing bootstrap rows before writing any
facts. Organization guards cover the record ID/public ID, current slug,
university subtype, official URL, institution-to-city link, and the one exact
primary organization domain. Location guards cover the record ID/public ID,
current slug, city subtype, and `CN` country code. A mismatch aborts the SQL;
the materializer never inserts into `records`, `organizations`, `locations`,
or `institutions`.

## Exact output

One complete run produces a `batchPurpose: "dependencies"` materialization
manifest and its business/evidence SQL with:

- 10 mapped existing records: 6 organizations and 4 locations;
- 10 real source documents, fetches, R2 artifact mappings, and source
  fragments;
- 16 accepted claims and 16 primary claim-evidence links;
- 16 accepted canonical fields;
- 0 programs, scholarships, program cycles, or scholarship cycles.

Each organization receives official English `localized.name` and
`official_url` facts. Each location receives an official English
`localized.name` fact. Every artifact backs at least one accepted primary
evidence link, and every accepted claim produced by this materializer points
to a fetch declared by the same batch.

Claim IDs include the normalized value, `checkedAt`, fetch ID, and fragment ID.
This preserves a real A → B → A history instead of reviving an older
superseded A claim. Re-running the exact business/evidence SQL is idempotent;
the materializer itself does not create or advance a batch.

## Commands

Generate a strict dependency materialization from a fresh priority harvest:

```powershell
npx tsx scripts/ingestion/materialize-official-dependencies.ts `
  --provenance-manifest .pipeline-build\priority-official-harvest\run-manifest.json `
  --output .pipeline-build\materialized-dependencies `
  --remote-contract
```

The command prints the generated materialization manifest path. Import that
manifest through the resumable importer:

```powershell
.\scripts\ingestion\import-official-entities.ps1 `
  -ManifestPath .pipeline-build\materialized-dependencies\official-dependencies-<hash>.manifest.json `
  -Remote `
  -Transport auto
```

Only the strict importer owns the control plane. It first validates immutable
package-level artifact bindings, creates the batch reservation, and pre-registers
every record intent; after the reservation is complete it moves the batch to
`importing` and executes this materializer's business/evidence SQL. It then
persists typed mappings and artifact rows, records verified resumable D1 chunks,
performs exact assertions, and atomically moves the validated records and batch
to `applied`. The materializer does not set `prepared`, `validated`,
`importing`, or `applied` workflow state.

Focused verification:

```powershell
npx vitest run tests/unit/official-dependency-materializer.test.ts
```
