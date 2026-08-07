# Entity candidate materializer

The Entity Candidate Materializer closes the gap between official catalogue
discovery and the canonical Pipeline D1 model. Discovery is intentionally cheap:
it records one immutable `extracted_entity_candidates` row for every programme or
scholarship link before MiniMax enrichment. Materialization is the trust boundary
that decides whether that identity can become an applied canonical record.

## Why this has its own mapping contract

`promotion_field_mappings` maps an aggregate ingestion source field to one known
record. It is not suitable for directory discovery because one source can contain
hundreds of entities whose candidate fields are all named `name`, `officialUrl`,
and `degreeLevel`.

Migration `0014_entity_candidate_materialization.sql` therefore adds:

- `entity_materialization_decisions`, an immutable final decision per candidate;
- `entity_candidate_field_mappings`, candidate-scoped mappings that preserve the
  one-source-to-many-record shape; and
- `entity_materialization_release_requests`, an immutable daily release window
  that coalesces many materialized identities into one existing Release Builder
  outbox event.

The strict `materialization_release_requests` contract from migration `0011`
remains unchanged. It is for complete offline packages containing at least 1,000
programmes and 50 scholarships plus an applied dependency batch. The incremental
entity request is deliberately separate and does not weaken that bulk-import gate.

## Deterministic gates

`materializeExtractedEntityCandidate` only materializes a candidate when all of
the following are true:

1. The candidate is validated/registered, has no issues, and meets the configured
   confidence threshold (980,000 ppm by default).
2. Its source manifest is valid and matches the candidate institution and source.
3. The source has an enabled binding to an active primary/secondary official
   `source_documents` row.
4. The source document URL exactly matches the normalized manifest URL, the
   immutable snapshot URL stays on an allowlisted HTTPS host, and the R2 key
   contains the snapshot's full SHA-256 digest.
5. Snapshot time, publisher ownership, evidence URLs, stable identity, entity
   key, and immutable entity digest all recompute exactly.
6. Scholarship provider ownership is explicit and registered; no other registry
   owns the same provider-scoped identity.

Low-confidence and invalid candidates are quarantined. Missing or inconsistent
source configuration is retryable instead of being misclassified as bad data.
Identity or digest
conflicts use the stronger `conflict` decision. Both paths reconcile the catalogue
item as `unparseable` with an explicit reason and create no record, claim, field,
or release request.

## Canonical write path

The stable record ID is the same deterministic identity used by the existing
official entity materializer:

```text
{entityType}-{sha256(entityType + NUL + ownerId + NUL + entityKey)}
```

For programmes, `ownerId` is the institution. For scholarships it is the
registered provider organization when supplied, falling back to the institution
only for school/faculty awards. Government awards require an explicit provider.

One D1 batch writes the record, domain row, localized name, immutable source fetch
projection, evidence fragments, claims, canonical fields, record version, active
registry binding, published reconciliation, decision, field mappings, and audit
row. D1 batches are the transaction boundary; a constraint or version race rolls
the entire candidate back. Reprocessing a decided candidate returns the persisted
decision without writing again.

The release request trigger revalidates every candidate, active registry, applied
record, and decision inside the insert statement. It creates one queued
`publication_jobs` row and one `catalog.release.requested` outbox event. A unique
UTC `release_window` limits this path to one regular release per day. Candidates
that miss the day's release remain discoverable by the scheduler and are included
in the next window.

## Worker integration

`processEntityMaterializationBatch` in
`workers/ingestion/src/entity-materializer-scheduler.ts` is the recovery-safe
scheduled entry point. It selects undecided candidates in deterministic order,
materializes them individually, records failures without blocking the rest of the
batch, and requests one coalesced release for materialized candidates that have not
appeared in an earlier entity release request.

Wire it after the hourly source scheduler using the same `INGESTION_DB` binding and
start with `candidateLimit: 20`. Keep queue/cron concurrency low until production
metrics confirm there are no record-version conflicts. The module performs no
network requests and calls no AI service.

## Verification

```powershell
npm run validate:d1
npx tsc -p workers/ingestion/tsconfig.json --pretty false --noEmit
npx tsx --test workers/ingestion/tests/entity-materializer.test.ts
npm run test:ingestion
npm run check:worker:ingestion
npm run test:entity-materializer
npm run check:worker:entity-materializer
```

The migration test must cover repeat application and foreign-key integrity. The
materializer tests cover successful evidence-backed materialization, replay
idempotency, low-confidence isolation, one-release-per-day behavior, and rejection
of a quarantined release cohort.
