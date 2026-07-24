# Automatic publisher bridge operations

`workers/publisher` is the deterministic bridge from validated ingestion candidates to canonical pipeline data and Catalog Release build requests. It has no approval endpoint and no alternate path around its gates.

## Flow

```text
ingestion_candidates (validated)
  -> publisher scheduler
  -> PROMOTION_QUEUE
  -> immutable provenance verification
  -> exact source + field mapping verification
  -> one D1 batch transaction
       source_fetches / source_fragments
       claims / claim_evidence
       canonical_fields
       change_sets / record_versions
       publication_jobs / outbox_events
       candidate_status = applied
  -> Catalog Release builder consumes catalog.release.requested

invalid provenance, missing mapping, unsafe type, or failed transaction
  -> rollback all canonical/publication writes
  -> candidate_status = quarantined
  -> promotion_isolations
```

The scheduled poller is a recovery mechanism as well as the normal entry point. A lost queue message is rediscovered while the candidate remains `validated`; an expired apply lease is also eligible again. All generated IDs are deterministic from the candidate, record, and field identities.

## Eligibility

Only these candidates can be applied:

- `dual-pass`, with two complete MiniMax envelopes whose values agree and whose persisted schema, model, prompt fingerprint, extractor fingerprint, and per-field evidence recompute exactly;
- `rule-pass` when the source manifest contains no critical extraction field.

`quarantined` is terminal and can never be promoted. Critical rule-only results, an incomplete provenance record, a changed manifest fingerprint, duplicate fields, missing evidence, or incompatible canonical types are isolated.

MiniMax primary and secondary envelopes are stored independently in the one-to-one `ingestion_candidate_provenance` row. `field_evidence_json` preserves both evidence quotes and locators for each accepted field. The candidate and provenance inserts share the ingestion D1 batch, so neither can commit alone. Source bodies remain in the private R2 snapshot bucket and are not copied to claims or queue messages.

## Required mapping configuration

The promoter never derives a canonical destination from a field name.

1. Insert an enabled `promotion_source_bindings` row linking the ingestion `source_id` to an active official `source_documents` row.
2. Define the target field in `field_definitions` for the target record kind, including `value_type`, `risk_class`, and a positive `max_age_days` freshness policy.
3. Insert one `promotion_field_mappings` row for every candidate field:

```sql
INSERT INTO promotion_field_mappings (
  source_id,
  candidate_field_path,
  subject_record_id,
  canonical_field_path,
  locale
) VALUES (
  'registered-source-id',
  'applicationUrl',
  'uni-example',
  'admissions_url',
  ''
);
```

Database triggers reject mappings whose target record and `field_definitions` entry do not match. If any fact in a candidate lacks one exact enabled mapping, the entire candidate is quarantined before claims are written. Aggregate fields such as `programs`, `scholarships`, or `guide` therefore remain isolated until a versioned extractor emits safely mapped record-level facts.

## Atomic apply and idempotency

`candidate_promotions` supplies a five-minute single-writer lease. After all read-only validation succeeds, the Worker executes the canonical mutation as one D1 `batch()` transaction. The transaction:

- projects the immutable R2 snapshot into `source_fetches`;
- creates one or two `source_fragments` per fact and attaches them through `claim_evidence`;
- moves each claim through `candidate -> validated -> accepted`, allowing the official-evidence trigger to enforce provenance;
- supersedes the previous accepted claim and upserts `canonical_fields`;
- applies one change set and record version per affected record;
- creates exactly one queued `publication_jobs` row and one pending outbox event;
- marks the promotion and ingestion candidate applied last.

A constraint, version race, or trigger error rolls back the whole batch. The Worker then records an automatic isolation. If the commit succeeded but its response was lost, the Worker reloads `candidate_promotions` and reports success instead of isolating an already applied candidate.

Reprocessing an applied candidate returns `already-applied` without changing claims, row versions, publication jobs, or outbox rows.

## Catalog Release outbox contract

The outbox event type is `catalog.release.requested`. Its JSON payload is:

```json
{
  "version": 1,
  "publicationJobId": "publication-job-...",
  "catalogReleaseId": "catalog-release-...",
  "candidateId": "candidate-id",
  "changeSetIds": ["change-set-..."]
}
```

The Catalog Release builder must claim pending events by lease, build the release solely from applied canonical data, update `publication_jobs.job_status`, and mark the outbox event delivered only after its release validation succeeds. Builder failure leaves the current catalog release unchanged and records the error on the publication job/outbox attempt.

## Worker handlers and bindings

- `scheduled`: selects validated, non-quarantined candidates without an active promotion lease and sends compact candidate-ID jobs.
- `queue`: runs promotion, retries transient runtime failures with bounded backoff, and sends terminal runtime failures to `PUBLISHER_DLQ` after attempting automatic isolation.
- `GET /health`: returns only service identity and version.

`workers/publisher/wrangler.jsonc` is the checked deployment contract; `wrangler.example.toml` is the equivalent copyable template. Required bindings are:

- `PIPELINE_DB`: the same D1 database used by ingestion, with migrations through `0006_candidate_provenance_promotion.sql`;
- `PROMOTION_QUEUE`: normal candidate promotion jobs;
- `PUBLISHER_DLQ`: exhausted runtime failures.

No credentials are required by this Worker. It performs no network fetches.

## Deployment and verification

```powershell
npx tsc -p workers/ingestion/tsconfig.json --pretty false
npx tsc -p workers/publisher/tsconfig.json --pretty false
npx tsx --test workers/ingestion/tests/*.test.ts
npx tsx --test workers/publisher/tests/*.test.ts
npm run check:worker:publisher
npm run typecheck
```

Before production deployment:

1. Back up pipeline D1 and apply migrations through `0006` in staging.
2. Load only explicit official source bindings and exact field mappings.
3. Run a dual-pass fixture and verify two evidence fragments, one accepted claim per fact, applied change sets, one record version per record, one publication job, and one pending outbox event.
4. Repeat the same candidate and verify all row counts and record versions remain unchanged.
5. Exercise quarantined, critical rule-only, unknown-field, incompatible-type, and record-version-race inputs; verify zero canonical/publication writes and one isolation record.
6. Deploy with publisher queue concurrency `1` initially and monitor promotion latency, isolation reason counts, expired leases, DLQ depth, and pending outbox age.
