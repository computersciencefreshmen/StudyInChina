# Official entity batch import

`scripts/ingestion/import-official-entities.ps1` is the only supported path
from harvested official-entity artifacts into Pipeline D1. It is intentionally
fail-closed: a materialization can be useful for local inspection without being
eligible for a remote import.

## Required manifest contract

Remote imports require a `studyinchina.pipeline.materialization` manifest with:

- a lowercase 64-character `batchId`;
- `materializerVersion` and `provenanceStatus: "complete"`;
- an explicit `batchPurpose`:
  - `catalog_entities` contains only programs and scholarships;
  - `dependencies` contains only organizations and locations, with at least one
    of each;
- exact non-zero record, claim, canonical-field, source-document, and
  source-fragment counts;
- zero program and scholarship cycles;
- one explicit `{ recordId, recordKind }` mapping per record;
- one source artifact per source document, with `sourceId`, `fetchId`,
  `localPath`, SHA-256, byte length, content type, capture timestamp, private
  `r2://studyinchina-source-snapshots/...` URI whose object key contains the
  complete 64-character artifact SHA-256, `isFixture: false`, and
  `captureMode: "live"`.

The packager recalculates the SQL hash and every local artifact hash and byte
length. It derives one immutable `packageDigest` from the materializer
version, batch purpose, source SQL SHA-256, exact counts, sorted record mappings,
and sorted source-artifact metadata (excluding only `localPath`). The same
digest is stored in the package, D1 batch, record intents, and every chunk
marker. Remote mode also rejects fixture paths. Missing fields never fall back
to guessed values or SQL-text inference.

Remote `catalog_entities` packages are additionally gated at 1,000 programs
and 50 scholarships. Dependency packages are imported separately and do not
weaken that catalog publication threshold.

## Packaging and transport

`package-official-entity-import.ts` tokenizes SQLite syntax instead of splitting
on newlines. It understands quoted semicolons, escaped quotes, identifiers, and
line/block comments. It rejects transaction control, schema mutation, cycle
mutation, and unsafe workflow application in materializer SQL.

The package contains two idempotent transports:

- one file payload followed by one batch-chunk marker;
- command-sized payload chunks, each followed by its own marker.

Each marker records the package digest, SHA-256, and statement count of the
exact payload before the marker. The marker is not included in its own hash and
must be the unique final SQL statement. Before every Wrangler chunk call, the
importer re-reads the file, recomputes its payload hash/count/bytes, validates
the tail marker, and compares all values with the in-memory package manifest.
Server-side `materialization_batch_chunks` rows are the sole resume cursor;
operators do not select or trust a local start-chunk number.

## Import order and apply gate

The importer performs these steps:

1. Build or accept the strict materialization manifest.
2. Package the import, recompute `packageDigest`, reproduce both transports
   from the declared source SQL, and verify every local artifact.
3. Apply Pipeline D1 migrations and query any existing batch. Reject a different
   package identity, transport chunk count, or a `failed`/`superseded` batch
   before making an R2 write decision.
4. For each content-addressed R2 key, GET first and verify bytes. Reuse an exact
   object without PUT; upload only a genuinely missing object and GET it back.
   An `applied` replay performs GET verification only and fails if an object is
   missing. Existing or mismatched objects are never overwritten.
5. In D1 create the immutable batch as `prepared`, move it to `reserving`,
   pre-register every typed record intent (new record IDs need not exist yet),
   verify the complete reservation, then move from `reserved` to `importing`.
   Only after all intents are reserved may materializer business/evidence SQL run.
6. Add typed mappings and source-artifact rows, validate records, and commit a
   chunk marker only when its package digest/hash/count match the batch. Query
   D1 markers and skip only exact server matches.
7. Verify exact reservations, mappings, record subtypes, accepted claims,
   canonical fields, official primary evidence from this batch, source
   artifacts, and zero associated cycles. Every accepted canonical claim must
   independently have same-batch primary-official evidence.
8. Execute one `UPDATE materialization_batches` statement. Its `BEFORE`
   trigger repeats every guard, preserves `published` status, advances every
   mapped record's row version and timestamp, and atomically changes the batch
   from `importing` to `applied`.
9. Query the same batch again and print success only when every exact assertion
   passes.

The `0010_materialization_batches.sql` trigger makes validation, record
application, and batch application one SQLite statement. A failed guard aborts
that statement, so both record and batch states remain unchanged. Applied batches, intents, mappings, chunks, artifacts,
and protected fetch metadata (including `completed_at` and deletion) are then immutable.

## Failure and replacement

Transient command/network failures leave the batch in its current active state
(usually `reserving` or `importing`), so the exact package can resume by
server markers. The importer never automatically changes an active batch to
`failed`. An operator may explicitly mark an unrecoverable batch failed. It
continues to suppress its intended records until a newer batch has fully
`applied` and covers every old `recordId + recordKind` intent. Only then may
one explicit atomic update set the old batch to `superseded` and name the
replacement batch. Active batches cannot be superseded, and incomplete
replacement coverage is rejected by D1.

## Commands

Build from live harvest inputs and import into local D1/R2:

```powershell
.\scripts\ingestion\import-official-entities.ps1 `
  -InputDirectory .pipeline-build\priority-official-harvest `
  -Transport command_chunks
```

Import an already-produced manifest remotely:

```powershell
.\scripts\ingestion\import-official-entities.ps1 `
  -ManifestPath .pipeline-build\materialized\official-entities.manifest.json `
  -Remote `
  -Transport auto
```

`auto` selects the resumable command-chunk transport before creating the batch;
it never creates one transport identity and silently falls back to another.
Re-running the same command reads D1 markers and resumes automatically.

Run the focused checks:

```powershell
npx vitest run `
  tests/unit/official-entity-import-packager.test.ts `
  tests/unit/official-entity-import-d1.test.ts
```

The focused tests apply all Pipeline migrations, exercise reservation-first
imports and tamper detection, prove that incomplete evidence/type/artifact
state rolls back finalization, verify published-record version advancement and
fetch immutability, and enforce explicit fully covered failed-batch replacement.
