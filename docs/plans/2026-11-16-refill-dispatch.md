# Bounded continuous refill: persistence and dispatch

The existing fifteen-minute watchdog remains the only scheduled bootstrap.
Continuous completion-driven refill needs separate model/capture reservoirs and
durable ownership before sending. This layer does not change provider requests,
model reservations, model concurrency, quota rules, facts or publication ACKs.
The coordinator owns capacity, epoch limits, alarms and stage permits. The
dispatcher supplies freshly proved candidates and atomic delivery ownership.

## APIs shared with the coordinator

`refill-dispatch.ts` imports the common `refill-contract.ts` types and exports:

- `selectRefillCandidates(env, {kind, limit, excludeJobIds, now?,
  allowExpansion?})` returns `{fence, candidates, nextDueAt}`. Limits are 1–8;
  `allowExpansion:false` selects only model `maintain` work, preserving urgent
  maintenance during an expansion quota reserve. Capture remains independent.
- `dispatchRefillCandidates(env, fence, candidates,
  {dispatchToken, epochSha256, now?})` returns `sent`, `notSent` and `unconfirmed`
  job IDs. The coordinator must first save the complete returned fence and all
  candidate descriptors under that token. Do not reconstruct only the four
  common fence fields: the returned fence also binds control/seed/legacy pins,
  selection time and atomic fairness offsets.
- `readRefillDispatchStatus(env, token)` verifies immutable candidate proofs
  against the D1 ledger and returns current real job states. No row is not proof
  that an in-flight caller cannot still commit; the coordinator must serialize
  its active operations.
- `observeRefillDispatch(env, token, jobId)` closes ownership only after actual
  attempt progress, running or a terminal job state. It never changes the job,
  a model outcome or a reservation. A timeout alone cannot close ownership.
- `declineRefillDispatch(env, {jobId, dispatchToken, epochSha256, reason,
  currentEpochSha256?})` returns `{declined, reason}`. Only the actual,
  authenticated Queue-delivery path may call it before claiming the job. An
  exact atomic baseline check plus immutable event proves
  `received_not_started`; the handler may ACK only after a true result.
- `planDueCaptureJobs(env, now?)` is re-exported from the repository. It only
  persists normal capture work and fresh target followups. One deterministic
  per-epoch event and one atomic batch cap new captures at 64 per fifteen-minute
  epoch even across scope/control revisions; it sends zero Queue messages.

`claimJob(env, jobId, now?, delivery?)` accepts optional
`{dispatchToken,epochSha256}`. Such a claim requires its exact active dispatch,
full job baseline, current source/control fence and original enqueue marker.
This races atomically against a preclaim refusal, so a late duplicate cannot
claim after refusal. The original no-metadata SQL remains unchanged.

## Persistence and unknown sends

Additive migration `0025_maintenance_refill_dispatch.sql` adds the dispatch
ledger, two small per-scope/kind fairness counters and lookup indexes. No model
or legacy ledger is reset. A partial unique index gives each job at most one
active dispatch (`prepared`, `sent` or `unconfirmed`).

Candidates reference content-addressed R2 proofs, each bounded to 128 KiB,
instead of placing large target JSON into coordinator state. Proofs contain the
exact SQL job/source tuples, school association set, actual snapshot/raw/text
hashes and only pinned target rows. Direct pins use bounded PK lookups; inherited
pins retain the existing bounded frontier graph validation. The claim batch
rechecks control, every full job/source tuple, exact targets/direct bindings,
uncertain model state and legacy STOPs before recording ownership and enqueue
time. All guards and writes are one D1 batch; any mismatch rolls everything
back. Each statement stays below 100 bindings and 100 KiB SQL.

Queue send happens only after that batch. The durable token/job/epoch plus
candidate hash prevent another owner or caller retry from sending it again.
A lost claim reply or Queue-send reply stays `unconfirmed`; no TTL or new token
replays it. A prepared row left by a crash before send is conservatively
unconfirmed too. Real job progress or a proved actual-delivery refusal is needed
to settle ownership. `sent` means confirmed Queue acceptance, never model
execution or successful catalogue growth.

Refusal reasons are fixed: `operator_pause`, `outside_canary`, `outside_scope`,
`models_disabled`, `targets_not_ready`, `source_disabled`, `permit_denied`,
`claim_rejected`, `budget_wait`, `quota_wait`, `stale_epoch`, `capacity_wait`,
`broker_attempt_limit` and `runtime_protected`. Cleanup is a bounded budget-hold
exception: it only closes an existing delivery, restores its original queued
enqueue marker and appends a receipt. It cannot send or change a model ledger.
The frozen migration source still returns before any storage access.

An old unknown model does not prevent a new read-only HTTP capture of that
source. Every model stage still checks current original bytes and all permanent
source/raw/text alias guards. Historical source-level unknowns do not prevent
closing a proved unstarted delivery, but a changed/unknown/running job baseline
does. This distinction never changes unknown provider outcomes.

## Fairness and cost boundaries

Model and capture selection run separately. Maintenance, programme expansion
and award expansion each retain at most 32 SQL candidates. The existing fair
selector chooses the small requested batch before expensive verification: at
most eight proof attempts total, including failures and future-due work, share
an eight-second invocation deadline. Already persisted proofs may be returned
when that deadline expires. All official scholarship categories
count toward award discovery. Atomic slot/expansion offsets retain the existing
70/30 and programme/award 2:1 allocations even with repeated one-slot refills in
one clock epoch. Urgent work may override shares and empty shares are borrowed;
scope-bound school rotation remains a scheduling hint, never a completion fact.

The SQL starts from indexed ready stage/status/due ranges, not completed job or
model history. Returned rows and artifact/proof work are explicitly bounded.
Ranking still reads the eligible due range: this is not an O(limit) billing
claim or a measured production cost saving. Future-due hints use only current
scope/canary, enabled-source queued/retry work and verify up to eight earliest
future candidates within the same total proof budget; unproved dates are omitted.
An R2 scan hint bound to scope/catalogue/control/canary advances before reads,
so failed or stalled candidates cannot indefinitely pin the same first page.
It changes no job/model state and authorizes no request. `scanRetryAt` requests
another bounded scan; it is not a factual job due date. A control change discards
the old hint. SQL ranking still may read the eligible range beyond that page.

Repeated R2 reads share materialized byte promises only within this selection,
retaining at most16MiB and returning repeatable wrappers instead of single-use
R2 bodies. Dispatch uses a fresh environment and still rechecks every proof and
CAS; final ModelAdmission never receives this cache. Ledger readers may explicitly
omit current job-state scans while retaining all immutable proof, tuple, hash and
refusal-receipt checks; coordinator lifecycle decisions use its fresh D1 job rows.
Local50ms-per-I/O tests and native R2 tests do not establish production latency.

Local SQLite and native workerd D1/R2 tests cover exact guarded dispatch,
preclaim refusal/claim races, lost replies, late control/source/target/unknown
changes, same-epoch fairness under a large priority-one maintenance backlog,
outside-stage separation and capture epoch caps. They make no real provider or
cloud calls and do not establish live throughput or quota exhaustion.
