# Capture recovery and bounded material contracts

The objective is to turn more captured official material into independently
reviewed facts without resending an uncertain paid request. This change does not
alter programme/year/language evidence rules or raise model concurrency.

## Capture failures

Only transport exceptions identified at the actual fetch/read boundary receive
60/300/900-second attempt backoff. Known HTTP/robots rules retain their existing
codes and behaviour. Redirect/security violations, empty/oversized bodies,
decoding failures, storage errors and unclassified JavaScript errors remain held.
No provider message, URL, header or error body is added to error codes.

## New material jobs

`material-batch-contract.ts` is the shared creation/reading contract. New v2 jobs
use explicit envelopes and distinct, content-bound job IDs. Selection belongs in
the repository creator: an existing logical v1/v2 job must be retained; a second
version must not be created to retry it. Deployment alone leaves v1 wire payloads,
reservation formulas, target batching and partition manifests unchanged.

V2 fields retain at most eight complete target pins and cycles five; identity
segments emit at most ten candidates. Every v2 source, including a short one,
uses the durable complete-document runner with owned spans of at most 12,000
characters and original-source context. Actual full text/hash, exact quote
location, independent review and cross-part conflict checks are unchanged.
`moreCandidates`/capacity limits remain explicit unfinished sections; the cursor
does not certify a complete school catalogue. Pre-existing unknown/in-flight
source history stops before a new send; v2 protection holds do not manufacture
another unknown outcome.

## Explicit source rechecks

`registerSourceRechecks` is intended for the existing authenticated admin router.
It accepts at most five enabled, exact original school-seed URLs inside current
scope/canary, a current revision/catalogue pin, and a complete original held
capture-row hash (including `enqueued_at`). The source must still have that
failure, with no newer capture. Permanent robots/content failures are excluded.

An immutable receipt and atomic event establish idempotency. The transaction
rechecks every source/job column, all school associations/seed bytes and current
controls. Fixed-column JSON arrays keep this exact-row guard below native D1's
expression-depth limit. Only independent queued capture rows are inserted. Old
jobs, source rows, provider reservations, acceptance facts and inspection evidence
are not updated; there is no direct queue send or model call. Normal capture and
all existing downstream no-replay guards remain authoritative.
