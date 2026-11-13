# Non-temporal FETCH permit recovery: offline implementation

The catalogue's paid request reservations and its temporary concurrency slots have
different responsibilities. A `request:*` reservation protects an uncertain paid
outcome permanently. A fetch/model slot limits concurrent operations temporarily.
This operation can retire only an explicitly reviewed FETCH slot with a finite positive expiry
greater than JavaScript's maximum representable timestamp (`8640000000000000`).
It never classifies a request as unsent, failed, completed, or safe to replay.

Root's PR96 diagnostics independently observed one active FETCH with expiry
`9007199254740991` (`Number.MAX_SAFE_INTEGER`), no active MODEL permits, and gate
SHA `8356487b2770a94729957bac0b6d0efcb2c57565fda20af37858ae8a6387152e`
at 2026-11-13 18:30:34 UTC. This branch remains local preparation only. A fresh
complete ledger summary and independent root approval are still required before
deployment or any invocation. An anomalous MODEL slot always holds for separate
review; this operation never changes the model array.

## Explicit operations

- A source-only authenticated read-only ledger summary returns a complete bounded
  request-ledger digest, state counts, gate digest, concurrency counts, freeze age,
  and eligibility. It never returns request keys, values, tokens, hosts, or raw gate.
- `GET /model-state-migration/ledger-summary` is the read-only operation.
- `POST /model-state-migration/non-temporal-fetch-permit-recovery` accepts an operation ID, exact migration ID,
  expected gate SHA, complete request-ledger SHA, expected anomalous fetch/model
  counts (`model` must be zero), and the operator's explicit decision/reason/review time. It is never
  called by a cron, queue handler, status read, freeze, export, or relay retry.

## Preconditions and one transaction

The actual source role/accounts/migration must match a durable source lock in
`frozen` phase with zero pages, no export manifest, and at least 120 seconds of
continuous freeze. Active asynchronous operations must be zero. Every normally
representable permit must already have expired. Malformed/non-finite/negative
values, unknown gate/permit/request schemas, unknown KV key categories, oversized
state, partial/unsorted scans, and ledger scans beyond the explicit bound hold.

The transaction enumerates the entire KV namespace in bounded pages (at most
4096 entries and 8 MiB canonical request-ledger content), recognizing only the
migration lock, gate, and exact `request:<64 lowercase hex>` keys. The request
digest uses typed canonical JSON and covers every key and its entire original JSON-compatible value in stable
order, including unknown/send_started/completed/known_failed and optional results.
Undefined fields, sparse arrays, non-JSON objects and negative zero hold because
the existing JSON migration cannot preserve them faithfully. It compares both operator-pinned hashes before any write. It repeats the complete
request digest after the gate-only write; any mismatch aborts the transaction.

Only selected non-temporal entries leave `gate.fetches`. A non-temporal entry in
`gate.models` refuses the operation, and the model array is never filtered. All other
gate fields and normal/expired permits are preserved. One immutable audit inside
the gate retains the complete original canonical gate JSON/hash, each original
permit and array position, operator decision/time, exact binding, and before/after
request-ledger SHA and counts. The gate including audit has a strict 64 KiB bound;
larger state holds without truncation. No new top-level KV key is introduced.

The first mutation requires a summary observation no older than five minutes.
The operation is idempotent only for the same operation ID, original gate hash,
ledger hash, and identical decision. Different operation IDs cannot overwrite an
existing audit. A later exact lost-response retry can return the existing receipt
without renewing its decision. Retrying additionally verifies the current gate equals the audited
result and that the complete request ledger remains unchanged.

## Migration and safety

The source lock never opens; target stays disabled. Original export `hasInflight`
and full namespace migration remain unchanged. Since the audit lives inside the
gate, the existing full DO export/import/finalize must preserve it exactly. The
audit is private DO data, never an R2/public response artifact. A successful local
test is not evidence that production permits are anomalous or that no model ran.

Verification includes exact ledger byte/content equality across recovery and full
DO migration; fresh hash conflicts, normal future permits, active operations,
young/wrong/sealed locks, malformed state, bounded scans, failed writes/rollback,
retries and changed IDs; authenticated HTTP routing; and real workerd transactions
with zero provider traffic. No force/retire-all/reset/lease-clearing mechanism is
introduced and no request or legacy STOP reservation is changed.
