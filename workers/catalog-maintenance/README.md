# Fixed-272 cloud catalogue maintenance

This Worker runs the durable acquisition and proposal side of the catalogue. It
does not mutate the six canonical JSON files, change Vercel aliases, activate
Catalog D1 releases, buy a subscription, or fall back to a PAYG API key. The
protected GitHub writer remains the sole canonical writer and public publisher.

## Data flow and boundaries

`GitHub 15-minute authenticated tick → Pipeline D1 jobs → Queue → robots/host-bounded source capture →
private R2 → typed proposals → finite export → GitHub evidence verification and
canonical commit → protected public release → exact acknowledgement`.

Program identities, scholarship identities and current record-field maintenance
have independent jobs. A shared source URL is fetched once; all its registered
categories are retained. A school identity, successful fetch, current fact and
published opportunity remain different states. The scheduler covers the fixed
272 identities, including the 17 currently withheld school identities.

The `ModelAdmission` Durable Object is one project-wide account gate, named
`subscription-account-v1`. It admits at most eight source tasks and one task per
host. Source redirects remain on the initially admitted exact host; links to
other already registered hosts require separate jobs. Model concurrency starts
at two and grows to three/four after healthy replies; definite HTTP429 rejection
halves it and establishes a durable cooldown. Other applications may consume the
same account quota, so the official five-hour and weekly windows are checked
again before each new request. The gate cannot control unrelated applications.

The model adapter uses only `MINIMAX_SUBSCRIPTION_KEY`, the explicitly configured
M3 model and an official Anthropic endpoint. No chat-completions/PAYG fallback is
implemented. A 20% quota reserve applies to expansion while current-field work
is pending. The default 5% overflow margin remains unless the existing account's
automatic credit fallback has independently been confirmed disabled. The quota
API cannot disable account billing settings.

Every model request is durably reserved **before** sending. A lost reply stays
`unknown` and is never automatically replayed. Definite provider429 rejection may
retry after its cooldown with a new append-only attempt receipt. Completed exact
requests reuse saved outputs. Historical record/source/snapshot STOP and consumed
reservations are imported without clearing or renaming them. Known snapshot
guards also match raw-byte aliases; hashless parent guards remain stronger.
An unavailable daily D1 allowance before admission, or a proven failure before
the provider send, remains scheduled waiting work. Neither condition authorizes
retrying a request whose provider outcome is unknown.

Current-field jobs are bound to a real source observation, record/year/intake and
field scope. Two independent extractions plus deterministic type/quote/scope
checks must pass. Later identical official captures can reuse the exact model
outputs and produce a newly dated leaf-field receipt. This never renews unrelated
fields or whole-record audit dates. PDFs require checksum-bound Poppler/OCR text;
unreadable documents enter a durable review state rather than repeatedly starving
the document queue.

The finite eight-job dispatch pool contains candidates from both expansion and
maintenance before selection. During the first actual school-check round, ten
15-minute ticks reserve 56 expansion/24 maintenance slots; afterwards they reserve
24/56. Urgent priorities run first and either lane borrows idle slots. Rechecking
a successfully captured source uses maintenance capacity. Acquisition scheduling
uses old canonical deadline scalars only as hints: a future deadline within seven
days caps the next successful capture at 24 hours, within 45 days at 72 hours,
and other active targets at 168 hours. Unlinked catalogues use 720 hours; stable
contacts/profiles retain 2160 hours. These hints never renew factual evidence or
whole-record dates.

## Local verification

```powershell
node --import tsx --test workers/catalog-maintenance/tests/maintenance.test.ts workers/catalog-maintenance/tests/runtime.test.ts workers/catalog-maintenance/tests/discovery.test.ts workers/catalog-maintenance/tests/proposals.test.ts workers/catalog-maintenance/tests/school-progress.test.ts
node --import tsx --test workers/catalog-maintenance/tests/rollout.test.ts workers/catalog-maintenance/tests/export-batches.test.ts workers/catalog-maintenance/tests/scheduling.test.ts workers/catalog-maintenance/tests/cadence.test.ts workers/catalog-maintenance/tests/scheduling-integration.test.ts
node node_modules/vitest/vitest.mjs run tests/unit/maintenance-field-engine.test.ts tests/unit/maintenance-documents.test.ts tests/unit/maintenance-cycle-engine.test.ts tests/unit/maintenance-scholarship-engine.test.ts
node node_modules/typescript/bin/tsc --project workers/catalog-maintenance/tsconfig.json --pretty false
node node_modules/eslint/bin/eslint.js workers/catalog-maintenance --max-warnings=0
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config workers/catalog-maintenance/wrangler.jsonc --outdir .tmp/catalog-maintenance-bundle
```

These tests use SQLite, memory buckets and mocked network/model responses. A
passing dry-run is a local bundle/binding check, not a production deployment.

## Deployment sequence

1. Inspect the existing account/project and resource metadata. Reuse the existing
   Pipeline D1 and snapshot R2 bindings. Create the dedicated maintenance queue
   and its dead-letter queue if absent; do not buy a plan or create replacement
   databases. Apply **only** the additive
   `infra/d1/pipeline/migrations/0019_catalog_maintenance.sql` migration to the
   intended Pipeline database after verifying the target. Do not run unrelated
   historical migrations as a shortcut.
2. Deploy `workers/catalog-maintenance/wrangler.jsonc` with
   `MAINTENANCE_ENABLED=false`. Configure `MAINTENANCE_ADMIN_TOKEN` and the existing
   MiniMax **SubscriptionKey** as Worker secrets using a protected input channel.
   Do not log them, put them in command arguments, commit them, or upload the CC
   Switch database. The website deployment and old ingestion Worker are separate.
3. For this Free account use the deferred `/bootstrap` flow below. Its seed must contain the exact pinned
   scope, current six-file catalogue hash, all 272 schools, record targets and
   complete legacy guard ledger. The API returns `validation:pending-queue`; the Queue
   applies checksum-bound SQL plans in at most 32 statements per continuation.
   Poll `/status` for `control.seed_complete=1`, `seed_offset=seed_total`, exact
   school/target/guard counts and both lane flags still disabled. No models can
   run during partial seeding. Cloud ticks recover a persisted-but-undispatched seed.
4. Keep the scope SHA pinned in Wrangler. Initial deferred activation applies only
   after readiness, with `MAINTENANCE_ENABLED=true` and revision exactly zero; it
   activates the explicitly stored five schools/model lane. A later pause or
   revision is never overwritten. For manual control, enable the deployment flag, then POST
   `/controls` with its observed revision, matching legacy guard SHA and the
   explicit first-five-school canary. The manual alternative may initially allow
   acquisition only before enabling its model lane. The deferred activation above
   preserves the explicitly authorized `modelsEnabled:true`. Empty canary means
   all 272 schools and is rejected on initial activation.
5. Read back first-five source, candidate, independent review, importer and public
   release evidence. The authenticated rollout evaluator below expands the canary
   by at most 20 schools only after its evidence gates pass. Routine
   passing proposals may publish automatically; access failures, conflicts,
   unsupported fields and unknown model outcomes remain review work.
6. Configure the GitHub maintenance publisher against this Worker. It should poll
   every 15 minutes, with one canonical writer, exact input-hash checks, protected
   deployment and stable-domain readback. The Worker makes regular exports at
   most once per two hours, capped at 20 schools/100 proposals; a fresh deadline
   patch due within seven days can bypass the regular interval. Waiting/no-work
   returns HTTP204. Existing prepared exports are always reused.

## Authenticated API

All routes except `GET /health` require the exact bearer admin token. They return
no credential values and disable caching.

- `POST /seed`: `{scopeRegistrySha256,inputCatalogSha256,schools,legacyGuards,
  recordTargets}`. Idempotent immutable bootstrap; changed seed hashes are rejected.
- `POST /bootstrap`: native known-length streamed initial seed/activation upload;
  see the exact headers and asynchronous validation contract below. The upload
  receipt proves durable pending intent, not validated data or activation.
- `POST /controls`: `{expectedRevision,legacyGuardSha256,enabled,modelsEnabled,
  canaryUniversityIds?:string[]|null}`. `null`/`[]` means full scope after canary.
- `GET /rollout`: current revision, active/new batch, immutable evidence references
  and exact holding reasons. `POST /rollout`: `{expectedRevision}` re-evaluates and
  atomically advances only an eligible batch. Every evaluation has an R2 decision
  receipt. A quota wait or an operator pause never resumes the lane automatically.
- `GET /status`: persisted progress, source observations, target/guard counts,
  model outcomes and lane flags. `/health` alone proves none of these.
- `POST /tick`: request the bounded scheduler and persist a real R2 runtime receipt.
- `GET /proposals`: latest bounded proposal metadata, including held proposals.
- `GET /documents`, `POST /documents`: checksum-bound PDF text handoff and durable
  failed-document observations. The GitHub helper processes at most five at once.
- `POST /exports`: `{limit:1..100}`; returns `{batchId,sha256,proposalCount,reused}`.
  `GET /exports/:batchId` returns the immutable shared candidate-export contract.
- `GET /artifacts?key=maintenance/...`: authenticated raw bytes, bounded to 10MiB;
  the consumer must independently verify every snapshot/text/review checksum.
- `POST /ack`: `{batchId,outcome:'applied'|'published'|'rejected',receiptSha256,
  sourceCommit,newInputCatalogSha256,acceptedProposalIds,heldProposalIds,
  unchangedProposalIds?,deploymentId?,stableProofSha256?}`. Proposal partitions must cover the exact
  export. `applied` records a canonical commit, **not** a public release. `published`
  requires the same applied commit/receipt/partition and exact stable proof.
  The optional unchanged IDs must be a duplicate-free subset of held IDs. They
  become consumed without requeueing a review conflict; the same set is required
  in the later published acknowledgement. Old acknowledgements default to `[]`.
- `POST /targets`: `{inputCatalogSha256,recordTargets}` after an applied canonical
  commit. The hash must match the Worker control head. This stages a resumable
  target refresh; current-field admission waits for `targets_complete=1`. Removed
  targets are deactivated, while old requests and audit evidence remain intact.
- `GET /publications`: applied, not-yet-published batches with their original
  acknowledgement metadata. Recovery must retain the original canonical commit,
  receipt and stable proof; it must not silently replace them with a later HEAD.

## Operational checks and recovery

Observe successful persisted cloud-tick/Queue progress, oldest due job, actual schools
attempted/captured, held/unknown counts, quota windows, prepared/applied/public
batches and target-refresh readiness. An empty queue or HTTP200 is insufficient.
Alerts should be quiet on unchanged state and report meaningful progress,
stalls, unknown outcomes or required review.

The existing Pipeline D1/R2 backup policy applies to these tables and artifacts.
Verify real backup readback and restoration independently. Queue delivery is
at-least-once; job claims, SQL cursor fences, immutable proposal IDs and model
reservations provide replay safety. Preserve failed/unknown receipts and the
previous stable deployment. Do not clear locks/reservations or bypass the
protected publisher to make a dashboard green.

## Current Free-account scheduling and durable bootstrap

The account's five Cloudflare Cron slots were already occupied. This Worker has
no configured Cron trigger. `catalog-maintenance-tick.yml` checks out `main` and
runs every 15 minutes only with `CATALOG_MAINTENANCE_MODE=cloud` and
`CATALOG_MAINTENANCE_TICK_ENABLED=true`. It receives the maintenance service token,
never a MiniMax key. Existing Cloudflare crons, databases and plans are unchanged.

Free shared daily D1 quotas and per-invocation query/CPU limits constrain actual
throughput. Each tick plans and dispatches at most eight sources/jobs. Schools
never actually attempted are prioritized before revisiting one school's many
pages; failed attempts and successful captures remain separate metrics. A tick
cadence is not a freshness SLA. An exhausted shared account waits for its UTC
reset rather than creating another database or buying capacity.

Initial registration uses authenticated `POST /bootstrap` with raw JSON
`{seed:<current bootstrap>,activation:{canaryUniversityIds:<exact five IDs>,modelsEnabled:true}}`.
Required headers are `Content-Length` (positive exact byte count, at most 8MiB),
`x-maintenance-bootstrap-sha256` (SHA-256 of exact raw body bytes),
`x-maintenance-scope-sha256`, `x-maintenance-canary-ids` (comma-separated five IDs),
and `x-maintenance-models-enabled:true`. HTTP preserves the native known-length
request stream when writing R2; it does not parse/hash the multi-megabyte seed
under the Free 10ms HTTP CPU budget. The Queue consumer independently verifies
actual size, raw hash, fixed scope and body/header activation consistency.

The immutable upload pointer accepts identical replays and rejects different
initial content. The response explicitly says `validation:pending-queue`.
Validated intent survives D1 daily-quota failure in R2. Later ticks queue seed
construction and bounded continuation inside the Queue's larger CPU budget.
Activation requires complete seed/legacy-guard readback and control revision zero.
It never overwrites an existing operator's later controls or pause.

`GET /status` returns `backend.state=ready` after successful D1 observation.
During a quota wait it returns `backend.state=quota_wait`, an actual UTC reset
time, and `null` for unavailable D1 control/counts rather than inventing zeros.
R2 retains immutable tick receipts, ETag-fenced daily histories, pending bootstrap
and the first eligible full-scope tick. `/status.soak` cannot pass before 168 real
hours; cadence gaps, truncated history and quota/failure waits prevent a pass.
Unit-test simulated time is not operational soak evidence. GitHub retains its
matching health artifacts for 35 days without provider credentials.

Discovery preserves complete checksum-bound frontier and missed-link manifests,
including pagination and PDF attachments. Five-link continuations bound query
usage. Depth/capacity limits remain explicit unfinished work, and long programme
or award sources require explicit partitioning instead of being silently cut.
New same-host notices inherit parent programme targets as candidates only; new
cycles still require exact programme/year/intake evidence and independent review.
`GET /schools` exposes actual school progress. `POST /reconciliations` can record
completeness only with the separate checksum-bound human review required by the
school-progress contract; a seed or download never counts as completion.

Each engine persists at most 100 proposals in one atomic batch of ten multi-row
statements, with at most 70 bound values per statement. A failing final chunk
rolls back the entire candidate batch rather than silently retaining only its
first programmes. The surrounding capture/review job remains durably retryable
under its existing outcome and model-reservation rules.

## Automatic staged rollout

The first five schools each need a real saved snapshot or an explicit durable
robots/source acquisition blocker with its next due date. Seed registration,
capacity waiting and internal execution errors do not qualify. At least one
batch from this maintenance system must have a checksum-bound published
acknowledgement containing its canonical commit, deployment ID and stable proof.
Unknown model/job outcomes, unfinished publication, incomplete targets, expired
leases or conflicting leases hold the current stage.

Once eligible, each committed decision adds the 20 least-recently attempted
remaining schools (the last batch has seven). The newly admitted batch must have
first-inspection evidence before another batch is admitted. R2 receipts and an
atomic D1 `rollout_advanced` event bind the progression to its previous scope;
an orphan `advance_proposed` R2 object does not prove a committed change. When
all 272 schools have actual first-inspection evidence, the canary becomes `[]`.
This does not mark their official catalogues fully reconciled. The revision CAS
and safety checks execute in one transaction, preserving a racing manual pause.
