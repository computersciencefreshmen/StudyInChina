# All-map university maintenance planner

The planner turns every university currently published under a published city into an inspectable maintenance queue. It does not restrict scope to universities that already have current programmes. Raw universities withheld by the existing publication policy appear separately as `hiddenUniversities`.

```powershell
node --import tsx scripts/automation/build-university-maintenance-plan.ts `
  --today 2026-10-17 `
  --data-dir content/data `
  --output .tmp/university-maintenance/plan.json `
  --state-file .tmp/university-maintenance/state.json `
  --limit 10
```

Omit `--today` to use the current China calendar date. The default batch limit is 10, bounded to 1–1000. Artifact paths must be distinct JSON files under `.tmp`, `.pipeline-build` or `quality` within the workspace, outside the data directory. Unknown, duplicate and incomplete arguments fail. Planning reads an existing state but does not create or update it.

## Output and interpretation

`universities` contains all visible schools, even when `selectedUniversityIds` is small. Each school has separate raw/current programme and cycle counts, programme identity-only/draft/archive counts, expired review counts, passed cycle deadlines, official source URLs, review dates and scheduling reasons. Counts can overlap: an identity-only programme may also have an expired review.

University identity freshness, programme review freshness and cycle deadlines are different properties. An institution can remain visible with zero current programme records. A current programme is not a claim that it has a current cycle or that applications are open. Use the existing application-state evaluator for that decision.

Priority reasons include zero-current programmes, no discovered programmes, expiry within seven days, overdue reviews and no current cycles. At equal attempt age, zero-current schools come before expiring schools, then overdue and routine work. Across runs, eligible untouched/oldest-attempted schools come first so repeatedly empty or failing schools cannot starve the rest. A repeat generation with identical inputs, state, date and limit produces the same plan hash.

`blocked` reflects an explicit durable consumer outcome only. A zero blocked count does not prove that all official sites are accessible; the planner makes no network requests and does not infer historical robots failures from catalogue facts.

The policy flags explicitly state that the planner performed no source acquisition, paid request, canonical write, fact verification or publication. These flags must remain separate from downstream execution receipts.

## Consumer contract

1. Consume only IDs in `selectedUniversityIds` and retain the exact `planSha256`.
2. Use the existing registered-source allowlists, robots policy, shared executor admission and paid-job controls. A plan is not a source manifest, a permission to run a model, or an executor lease. Serialize the execution workflow; generating two plans does not reserve exclusive execution.
3. Record actual outcomes after work, not after queue generation. Allowed values are `captured`, `unchanged`, `failed`, `blocked` and `no_sources`. `captured` means source acquisition only, never factual approval. No outcome renews catalogue verification dates.
4. Save a result receipt in an artifact path, with at most one result per selected school:

   ```json
   {
     "format": "studyinchina.university-maintenance-results",
     "version": 1,
     "planSha256": "<exact 64-character SHA-256 from the consumed plan>",
     "results": [
       {
         "universityId": "uni-sun-yat-sen-university",
         "outcome": "blocked",
         "attemptedAt": "2026-10-17T08:00:00.000Z",
         "errorCode": "robots_http_403"
       }
     ]
   }
   ```

   The ID and example outcome are illustrative, not an observation that this school was selected or checked. Only emit them after the actual selected attempt. `attemptedAt` must fall on the plan's China calendar date; `errorCode` is an optional short machine code, not a raw response or secret-bearing message.

5. Record that receipt with the same date, data, state and limit:

   ```powershell
   node --import tsx scripts/automation/build-university-maintenance-plan.ts `
     --today 2026-10-17 `
     --output .tmp/university-maintenance/plan-next.json `
     --state-file .tmp/university-maintenance/state.json `
     --limit 10 `
     --record-attempts .tmp/university-maintenance/results.json
   ```

   The exact plan hash must still match. Changed catalogue inputs, date, batch size or state invalidate the receipt; do not relabel it as a new attempt. Retain its evidence and reconcile it explicitly with the execution owner. Same-day partial receipts are allowed, but each state revision requires a new plan before another receipt is recorded.

6. State writes acquire an exclusive sibling `.lock`, compare the previously read state hash and atomically replace the state. A busy lock or changed state fails; the CLI does not delete another owner's lock or automatically replay results. Successful source capture/unchanged checks wait until the next China day, failures back off 1/2/4/8/14 days, missing sources wait seven days and blocked sources fourteen days. These are scheduling cooldowns, not evidence-freshness extensions.

7. Persist the state file across scheduled runs, or store the same state in the existing guarded database adapter. Ephemeral CI storage alone loses fairness history. Publication remains a separate evidence-qualified operation with immutable and stable-domain readback.

## Bounded source-only acquisition

An optional local executor consumes the exact plan, current catalogue inputs, durable state and China date. It needs no Cloudflare or AI credentials:

```powershell
node --import tsx scripts/automation/capture-university-maintenance-sources.ts `
  --plan .tmp/university-maintenance/plan.json `
  --today 2026-10-17 `
  --state-file .tmp/university-maintenance/state.json
```

The executor accepts at most 20 selected schools in one plan and visits at most two approved admissions/source URLs per school. It uses two school workers, at least five seconds between requests to the same domain, a 20-second deadline and a 2 MiB response limit. HTTPS, public DNS addresses, credential-free URLs, exact approved hosts and robots policy are enforced. An access block remains held; redirects do not add new allowed hosts.

Raw source and robots bytes, hashes, status, final URL and observation times are saved beneath `.official-harvest/university-maintenance/<planSha256>/`. Only same-allowlist admissions/catalogue link candidates are extracted. Candidate links are not fetched automatically, programme identities are not certified, and unchanged bytes do not extend verification dates. Reports label successful acquisition `captured_pending_review`; the separate scheduling receipt uses `captured` or `unchanged`.

Each recorded attempt persists a `sourceOffset`; subsequent batches rotate through the school's approved source list rather than repeatedly checking only its first two URLs. Missing offsets in historical receipts default to zero without rewriting the original receipt. The collector decodes declared HTTP/meta charsets (including legacy Chinese pages) for candidate-link discovery while retaining the exact original bytes and their hash. DNS restrictions are enforced again by the HTTP client's socket lookup, closing the gap between an initial host check and the actual connection.

Scheduling receipts retain the admitted plan's timestamp/date separately from `completedAt`. A finite batch crossing China midnight can record its true completion without pretending that the source was checked before midnight; it cannot bind itself to a different plan/date or renew factual verification. A zero-selected plan produces no invented attempts and does not advance scheduling-state revision.

The exclusive capture lock serializes runs. A complete immutable hash checkpoint reuses an exact finished run without new requests. Per-source started/terminal markers prevent automatic replay of an interrupted request. A started marker without its terminal checkpoint requires explicit reconciliation; the executor never clears it to retry. A crash can leave the capture lock, which also needs owner reconciliation rather than automatic deletion.

Record the resulting scheduling receipt with the original plan's date, data, state and limit:

```powershell
node --import tsx scripts/automation/build-university-maintenance-plan.ts `
  --today 2026-10-17 --limit 10 `
  --state-file .tmp/university-maintenance/state.json `
  --output .tmp/university-maintenance/plan-next.json `
  --record-attempts .official-harvest/university-maintenance/<planSha256>/results.json
```

Only `--record-attempts` may read this private evidence path; plan and state outputs remain in the ordinary artifact directories. Keep the actual plan hash in place of the illustrative placeholder. This source-only checkpoint does not replace the shared paid executor or guarded publication stages.

## Persistent local operational database

Node 24's built-in SQLite support provides a queryable maintenance ledger without an additional package or a Cloudflare request:

```powershell
node --import tsx scripts/automation/sync-university-maintenance-db.ts `
  --plan .tmp/university-maintenance/plan.json `
  --report .official-harvest/university-maintenance/<planSha256>/report.json `
  --database .tmp/university-maintenance/maintenance.sqlite
```

`--report` is optional: a plan alone persists all visible and hidden university coverage. An attached collector report must match the exact plan, selected schools and approved URL scope. Any stored raw hash must match the actual bounded raw file before ingestion. The database stores references, hashes, counts, status and dates; it excludes raw source contents and credential-bearing URLs.

This is a **local maintenance query mirror**, not the factual admissions catalogue and not a replacement for Cloudflare D1. The website's JSON delivery path remains unchanged. JSON maintenance state remains the execution authority for fairness and retries; changing SQLite rows does not authorize work, renew facts, or publish anything.

The ledger has a versioned schema, prepared statements, foreign keys and one transaction per ingestion. Repeated plan/report ingestion preserves unique rows rather than inflating counts. `university_coverage` exposes the current map visibility and counts; `maintenance_runs`, `coverage_history`, `university_attempts` and `source_observations` retain history. Removed schools are deactivated rather than deleted. Hidden-school programme/cycle detail counts are `NULL` because the plan's hidden identity entries do not provide those counts; current-public counts are zero. `captured_pending_review` remains a source-acquisition status.

An older date or lower state revision may add history but cannot replace the current coverage head. When two snapshots have the same date/revision but different catalogue hashes, the existing head is retained: their order is unknown. The JSON scheduler must emit a later state revision or date before that newer coverage is adopted. A different report cannot replace the immutable report already attached to one exact plan.

SQLite uses the standalone rollback-journal mode (`DELETE`), not WAL, and is closed before the command returns. A scheduler should cache the closed database together with its matching JSON state and private source checkpoints. Restoring only an ephemeral database or only state loses part of that local history. Cache storage is not a substitute for the existing protected D1 backups.

Example read-only queries with `node:sqlite` are:

```sql
SELECT university_id, raw_program_count, current_program_count, reasons_json
FROM university_coverage WHERE active=1 ORDER BY current_program_count, university_id;

SELECT university_id, checked_at, http_status, outcome, raw_sha256
FROM source_observations ORDER BY checked_at DESC;
```

## Validation

```powershell
npx vitest run tests/unit/university-maintenance-plan.test.ts tests/unit/university-maintenance-capture.test.ts tests/unit/university-maintenance-db.test.ts
npx eslint src/lib/maintenance/university-coverage.ts scripts/automation/build-university-maintenance-plan.ts scripts/automation/capture-university-maintenance-sources.ts scripts/automation/sync-university-maintenance-db.ts tests/unit/university-maintenance-plan.test.ts tests/unit/university-maintenance-capture.test.ts tests/unit/university-maintenance-db.test.ts --max-warnings=0
```

On Windows environments whose default temporary directory rejects Vite's atomic cache rename, point `TEMP` and `TMP` for the test process at a dedicated workspace `.tmp` directory. This does not change planner semantics.
