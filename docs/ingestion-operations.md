# Ingestion Worker operations

This Worker is the collection boundary for StudyInChina official-source data. It automatically schedules registered sources, enforces source and redirect allowlists, stores immutable source snapshots, detects meaningful changes, runs deterministic extraction, and isolates any result that cannot pass its gates.

It never accepts an arbitrary URL from an HTTP request. `/enqueue` accepts only a pre-registered `sourceId`. Raw snapshots and failed extraction fields are not publication data.

## Runtime layout

```text
Cron Trigger
  -> D1 due-source query
  -> INGESTION_QUEUE
  -> robots policy + allowlisted HTTPS fetch
  -> ETag / Last-Modified / raw SHA-256 / canonical SHA-256 gates
  -> R2 immutable snapshot when canonical content changed
  -> deterministic rules
       -> complete: rule-pass candidate
       -> incomplete: two independent MiniMax extractions
            -> exact values + grounded evidence agree: dual-pass candidate
            -> any disagreement or invalid evidence: QUARANTINE_QUEUE

Transient delivery failure -> delayed retry -> INGESTION_DLQ after the limit
```

MiniMax is the only LLM channel. No other model is called by the Worker. A quarantined candidate cannot be consumed by the publication path; it becomes eligible only after a changed parser or source manifest produces a new `rule-pass` or `dual-pass` candidate.

## Handlers

- `scheduled(controller, env)`: runs hourly, selects due enabled sources, claims an idempotent job in D1, and sends it to `INGESTION_QUEUE`.
- `queue(batch, env)`: processes each job, acknowledges successful or terminal messages, and applies bounded delayed retries to transient failures.
- `GET /health`: returns only the service name and version. It intentionally exposes no source, storage, queue, or cost data.
- `POST /enqueue`: authenticated source re-enqueue. The JSON body is `{ "sourceId": "registered-source-id" }`; URLs are rejected by design.

## Required bindings and secrets

Copy `workers/ingestion/wrangler.example.toml` to the deployment configuration and replace resource placeholders.

Bindings:

- `INGESTION_DB`: D1 operational database.
- `SNAPSHOTS_BUCKET`: private R2 bucket for source bytes.
- `INGESTION_QUEUE`: normal fetch jobs.
- `INGESTION_DLQ`: terminal or malformed job records.
- `QUARANTINE_QUEUE`: changed snapshots whose extracted fields failed deterministic gates.

Secrets must be installed with `wrangler secret put` and must not be committed:

- `MINIMAX_API_KEY`: bearer credential for the configured MiniMax-compatible HTTPS endpoint.
- `INGESTION_ADMIN_TOKEN`: long random bearer token for `/enqueue`.

Non-secret variables include the explicit `MINIMAX_API_URL`, enabled model name, timeouts, maximum source bytes, queue attempts, and a transparent crawler user agent with a policy/contact URL. The example endpoint and model are deliberately invalid placeholders.

## Infrastructure cost circuit breaker

`INFRA_FORECAST_CNY` is a non-secret monthly infrastructure-cost forecast. An external monthly cost job owns and updates this value; the Worker does not call a billing API. The pure runtime policy has fixed CNY thresholds:

- below `60`: `normal`;
- `60` through below `80`: `warning`;
- `80` through below `95`: `constrained`;
- `95` or greater: `freeze_discovery`.

`constrained` explicitly disables browser fallback. This Worker currently has no browser fallback implementation, so source collection remains direct HTTP only. `freeze_discovery` additionally prevents the scheduler from creating `reason=discovery` jobs. Registered `catalog_anchor` sources are discovery seeds; registered current admissions, deadline, and university/faculty/government scholarship sources remain `reason=scheduled` and continue to be checked. A malformed configured forecast fails closed to `freeze_discovery`; an omitted value is treated as zero for initial deployment. `/health` never returns the forecast or cost mode.

## D1 contract

Migrations are owned by `infra/d1`; this Worker expects the following table and column contract.

### `ingestion_sources`

Required columns:

`source_id`, `manifest_json`, `enabled`, `next_fetch_at`, `etag`, `last_modified`, `raw_sha256`, `canonical_sha256`, `last_checked_at`, `last_success_at`, `last_enqueued_at`, `consecutive_failures`, `last_error_code`, `created_at`, `updated_at`.

`source_id` is the stable primary key. `manifest_json` contains Source Manifest version 1. Index `(enabled, next_fetch_at)` for the scheduler.

### `ingestion_jobs`

Required columns:

`job_id`, `source_id`, `status`, `reason`, `scheduled_at`, `attempt`, `outcome`, `started_at`, `completed_at`, `error_code`, `error_message`, `created_at`, `updated_at`.

`job_id` is the primary key. Active statuses are `queued`, `running`, and `retrying`; the scheduler will not enqueue another active job for the same source.

### `ingestion_snapshots`

Required columns:

`snapshot_id`, `source_id`, `r2_key`, `raw_sha256`, `canonical_sha256`, `content_type`, `byte_length`, `final_url`, `fetched_at`, `etag`, `last_modified`.

Use unique constraints on `snapshot_id`, `r2_key`, and `(source_id, raw_sha256)`.

### `ingestion_candidates`

Required columns:

`candidate_id`, `source_id`, `snapshot_id`, `extractor`, `gate_status`, `facts_json`, `issues_json`, `created_at`.

Allowed gate statuses are `rule-pass`, `dual-pass`, and `quarantined`. The publication query must explicitly allow only the first two values.

### `ingestion_robots_cache`

Required columns:

`host`, `body`, `status_code`, `fetched_at`, `expires_at`.

`host` is the primary key. The Worker caches successful, 404, and 410 decisions for 24 hours.

All timestamps are UTC ISO-8601 strings. D1 foreign keys should connect jobs, snapshots, and candidates to `ingestion_sources`, while snapshot deletion is restricted when a candidate refers to it.

## Source Manifest version 1

`workers/ingestion/source-manifest.example.json` is the canonical example. The TypeScript contract is `SourceManifestV1` in `workers/ingestion/src/types.ts`.

Important fields:

- `institutionId`: stable institution identifier used to reconcile required source coverage per university.
- `sourceCategory`: one of `international_admissions_home`, `undergraduate_catalog`, `masters_catalog`, `doctoral_catalog`, `non_degree_catalog`, `current_guide`, `dates_deadlines`, `fees`, `eligibility_language`, `application_portal`, `university_scholarship`, `faculty_scholarship`, `government_scholarship`, `program_detail`, `contacts`, or `catalog_anchor`.
- `officialUrl`: one credential-free HTTPS URL.
- `allowedHosts`: exact official hostnames. Wildcards, IP literals, local names, credentials, non-default ports, and non-HTTPS URLs are invalid.
- `allowedRedirectHosts`: exact additional hosts that a known official source may redirect to. Redirects are followed manually and revalidated before the next request.
- `schedule.intervalHours` and deterministic `jitterMinutes`: spread source load without random schedule drift.
- `robots.mode`: `enforce` fetches and applies robots rules; `blocked` prevents collection.
- `canonicalization.ignorePatterns`: trusted, bounded regular expressions for volatile template fragments. Keep this list narrow; never strip dates, money, requirements, or application text.
- `extraction.fields`: the only field paths MiniMax may return. Each path has a runtime type, nullability, requirement flag, and optional critical marker.
- `extraction.rules`: bounded regular expressions for text/HTML or JSON Pointers for JSON.
- `extraction.mode`: `rules-only`, `rules-then-minimax`, or `minimax`.

Reconciliation state is deliberately absent from Source Manifest. Coverage and candidate tables derive it from the set of enabled `(institutionId, sourceCategory)` manifests and their latest successful outcomes.

Invalid manifests fail closed before a source request is made.

## Network and robots policy

The Worker performs these checks before requesting source content:

1. URL scheme must be HTTPS; credentials and non-default ports are forbidden.
2. The normalized hostname must exactly match `allowedHosts`.
3. IP literals, localhost, `.local`, `.internal`, `.home.arpa`, and related local targets are rejected.
4. Redirect handling uses `redirect: manual`; each `Location` target must match the source or redirect host list before it is fetched. At most five redirects are followed.
5. `robots.txt` is fetched from the source origin, limited to 512KB, cached for 24 hours, and evaluated for `StudyInChinaDataBot`. A disallowed path is blocked. A 5xx or ambiguous robots failure is retryable and does not default to allow.

The registered host allowlist is the primary SSRF boundary. Do not add user-controlled URLs or wildcard domains to a manifest. DNS/host policy changes must be represented as a manifest version change.

Use a descriptive `USER_AGENT` with a working collection-policy page and contact address. Do not add authentication cookies, CAPTCHA handling, proxy rotation, or 403 bypasses. Configure source schedules and queue concurrency so the same institution is not contacted aggressively; the example starts with global HTTP concurrency 2 and deterministic schedule jitter.

## Change and snapshot gates

Requests send `If-None-Match` and `If-Modified-Since` when state is available.

1. HTTP `304`: update check time and stop.
2. Raw SHA-256 unchanged: do not write R2 and stop.
3. Raw bytes changed but canonical SHA-256 unchanged: update the latest raw hash, classify as template noise, and stop.
4. Canonical SHA-256 changed: store the raw bytes and run extraction.

R2 objects are content addressed:

```text
snapshots/{first-two-hash-characters}/{source-id}/{raw-sha256}.{extension}
```

The Worker checks `head()` before `put()`, so retrying after a partial D1 failure does not create a second object. Snapshot metadata includes both hashes, source ID, fetch time, MIME type, byte length, final URL, ETag, and Last-Modified.

HTML and text default to 10MB maximum; the hard manifest limit is 50MB. Unsupported binary content is snapshotted and quarantined without being sent to MiniMax.

## Extraction gates

Deterministic rules run first unless the manifest selects `minimax`.

For MiniMax fallback, the Worker sends two independent requests in parallel. The second pass receives the field schema in reverse order. Both requests use temperature zero and JSON-only output instructions. Page contents are explicitly labelled untrusted data.

`dual-pass` requires all of the following:

- exact source ID and schema version;
- only allowlisted field paths;
- runtime type and calendar-date validation;
- no duplicate paths and all required fields present;
- every evidence quote appears verbatim after Unicode and whitespace normalization of source text;
- both passes produce byte-stable canonical JSON values for every field;
- any value also produced by a deterministic rule agrees with MiniMax.

Any failure produces `quarantined`. Quarantined output and its snapshot remain auditable but are excluded from publication.

## Retry and DLQ convention

Application retries are bounded by `MAX_QUEUE_ATTEMPTS` (default 4):

`15 minutes -> 2 hours -> 12 hours -> 24 hours`.

HTTP 408, 429, 5xx, network failures, and timeouts are transient. A valid `Retry-After` value overrides the default delay but is capped at 24 hours. Authentication failures, policy blocks, robots disallow, unsafe redirects, invalid content, response-size violations, and missing source registrations are terminal.

On the last application attempt, the Worker records a structured `IngestionFailure`, sends it to `INGESTION_DLQ`, acknowledges the original message, and delays the source's next scheduled check by seven days. Worker crashes that occur outside per-message handling are also covered by the queue consumer's configured `max_retries` and `dead_letter_queue`.

DLQ and quarantine consumers must deduplicate on `failureId` and `quarantineId`. Queue messages contain IDs and small metadata only; raw content stays in R2.

## Deployment and verification

From the repository root:

```powershell
npx tsc -p workers/ingestion/tsconfig.json --pretty false
npx tsx --test workers/ingestion/tests/*.test.ts
npm run typecheck
```

Before deployment:

1. Apply the separately owned D1 migrations.
2. Create the three queues and private R2 bucket.
3. Put both secrets through Wrangler.
4. Load manifests only after validating them with the exported TypeScript validator in a controlled import command.
5. Deploy to a non-production Worker name and enqueue one static HTML fixture source.
6. Confirm one R2 object, one snapshot row, one candidate row, and no secret or raw body in Worker logs.
7. Exercise a 304, raw duplicate, canonical duplicate, unsafe redirect, 429 retry, deterministic rule pass, MiniMax disagreement, quarantine, and DLQ terminal path.
8. Promote the same version and retain the previous Worker deployment for rollback.

## Operational signals

At minimum, aggregate these counts from D1 and queue analytics:

- due, queued, running, completed, retrying, and failed jobs;
- HTTP status families, timeouts, unsafe redirects, robots blocks, and bytes downloaded;
- not-modified, raw-duplicate, canonical-duplicate, and canonical-change outcomes;
- rule-pass, dual-pass, quarantined, and DLQ totals;
- oldest active job, oldest quarantine item, consecutive failures per source;
- R2 bytes added and MiniMax calls per canonical change.

Alert when the scheduler has no heartbeat for 26 hours, DLQ is non-empty, the oldest active job exceeds 24 hours, a source fails three consecutive runs, or quarantine growth exceeds the parser-maintenance capacity. Never log bearer tokens, MiniMax prompts/responses, raw source bodies, or R2 signed URLs.
