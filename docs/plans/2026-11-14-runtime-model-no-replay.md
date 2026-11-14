# Reviewed runtime model unknowns

The maintenance service can preserve ambiguous model outcomes while continuing
other schools. This does not determine whether a provider billed a request,
produce a successful model result, publish a record, or acknowledge an old batch.
The original SQL unknowns and durable request entries remain unchanged.

This is separate from the immutable three legacy model unknowns and the three
lease-expired jobs. Their policies, migration proofs, and registrations retain
their original meaning. Runtime registration rejects those existing policy IDs.

## Trust and ordering

1. An authenticated operator chooses 1–8 **existing** unknown attempt IDs and an
   operation ID. Models must be paused through normal controls, at the current
   revision and the fixed 295-school scope. Captures/model work must have drained:
   no running SQL jobs, reserved/send-started SQL attempts, active DO operations,
   or unexpired fetch/model permits. The 295 scope rows are checked as well.
2. The same existing account admission DO takes an exclusive in-process operation
   gate before awaiting storage. An ongoing quota/provider preflight counts as an
   active operation. New business admissions receive a bounded capacity wait
   while evidence is prepared or registered. No new DO or model reservation is
   created.
3. Worker code reads full attempt and matching unknown job tuples from D1. It
   obtains the actual durable `request:<original reservation>` entry, requiring
   its unknown state, attempt ID and request hash. Snapshot JSON, raw official
   bytes and complete captured/derived text are read and hashed from R2. Text
   aliases include the actual full text and the capture pipeline's own
   `normalizeEvidenceText` result. Caller-supplied tuples/hashes are rejected.
4. Prepare conditionally writes a canonical content-addressed proof and CAS
   appends its SHA to `maintenance/runtime-model-guards/index.v1.json`. This is
   **already a permanent NO_REPLAY deny**, without an operational waiver. A fixed-key D1 audit marker is durably confirmed before prepare reports success, so a subsequently missing index fails closed. A crash
   or declined review does not reactivate these sources.
5. Register rechecks the actual DO entries, idle state, all original bytes and
   SQL tuples. It writes/readbacks an immutable registration receipt, then one
   atomic D1 batch checks controls/revision/scope, all tuples, source identities
   and ownership, and appends the exact registration event. A late mutation
   rolls back the event. Unknown statuses, keys, hashes and outcomes are never
   edited. Lost replies can be read back idempotently against the same proof.

Proofs are limited to 256 KiB; the permanent index to 32 proofs. Raw objects over
16 MiB, text over 2 MiB, more than 16 matching jobs, missing artifacts, malformed
proofs or capacity exhaustion hold explicitly. There is no truncation or cleanup
endpoint. An invalid older registration is not silently superseded.

## Admission and rollout

The index is read before partition/engine work and before account admission. The
final admission boundary checks it again before adding a permit or send-started
reservation. Source IDs, original raw SHA, reservation/payload SHA and trusted
full/normalized text aliases remain denied across new URLs, request keys, passes,
models and scope versions. A denial becomes held work, not a new unknown outcome.
An absent committed index is detected using a fixed event primary-key probe;
there is no per-request event-history scan or provider request during auditing.

An operational waiver requires an intact immutable receipt/event, exact current
SQL tuples and original evidence. Normal revisions within the same scope preserve
it. Changing scope invalidates the waiver; permanent denial remains. This version
only registers at the fixed 295-school scope; a future registry transition needs
an explicitly reviewed registration contract.

Status and rollout expose total unknown models/jobs, legacy protected models,
lease quarantined jobs, runtime protected models/jobs, and the remaining unknown
sets separately. Attempts and jobs are deduplicated by their own identities.
Rollout computes unresolved **identity sets**, not a blind subtraction. Its one
atomic control-update batch combines the existing legacy/lease fences with all
runtime exact tuple counts, ownership and immutable-event predicates. A new
unregistered unknown, deleted row, changed status/hash, stale send, altered proof
or control race still holds expansion. Health continues to describe unknowns as
unknown history, never model successes.

## Administrative interface

Use the existing maintenance origin and administrator authorization; do not print
tokens. Existing workflows/queue controls should keep unrelated work from racing
the short registration operation. No extra schedule is installed.

`POST /runtime-model-guards/prepare` (maximum HTTP body 8 KiB):

```json
{"operationId":"operator-reviewed-runtime-001","expectedRevision":15,"attemptIds":["actual-existing-attempt-id"]}
```

The response provides `proofSha256`, `permanentNoReplay:true`, and
`registered:false`. Review the canonical proof at
`maintenance/runtime-model-guards/proofs/<proofSha256>.json` through the existing
authenticated artifact read. Do not invent missing proof artifacts.

`POST /runtime-model-guards/register`:

```json
{"proofSha256":"<actual prepare response SHA>","expectedRevision":15,"operatorId":"actual-reviewer-id","decision":"preserve_unknown_permanent_no_replay"}
```

`GET /runtime-model-guards` reports registered counts and disposition state without
returning raw source/model evidence. The existing CLI supports
`prepare-runtime-model-guards body.json` and
`register-runtime-model-guards body.json`. Resume ordinary controls, queues and
the existing tick/publisher only after verifying the actual registration result;
registration itself does not resume them or authorize a model call.

Tests exercise real SQLite transaction rollback, original DO request preservation,
late tuple/source changes, another unknown, malformed proof, scope change, alias
replay through queue/DO paths, and an actual workerd HTTP→DO→D1/R2 registration
with every outbound request intercepted and no provider traffic.
