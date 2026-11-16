# Continuous, bounded MiniMax catalogue acquisition

Goal: keep eligible official-source work supplied to the existing subscription
model, while increasing independently reviewed, published school coverage.
The 15-minute GitHub schedule remains the sole external scheduler and recovery
watchdog. It wakes one dedicated durable refill coordinator rather than acting
as the only producer of ordinary jobs.

## Architecture and ownership

- `CatalogRefillCoordinator` uses a new SQLite Durable Object namespace and an
  additive D1 delivery ledger. It never alters `ModelAdmission`'s reservation,
  migration, unknown-outcome or provider-send state.
- Capture and model candidates have independent reservoirs. Each refill sends
  at most eight jobs, after durably saving the complete candidate tuples and a
  delivery token. Delivery uncertainty retains its capacity reservation until
  actual D1 job progress proves an outcome; a timeout is not completion.
- Default watermarks are eight model jobs and two captures. When model work is
  eligible, captures acquire a real stage permit before claiming a job. Empty
  lanes can lend capacity. Provider admission remains at most four; pilot model
  stage permits start at two.
- Each 15-minute epoch may allocate at most 256 model jobs and 64 captures.
  Counters survive repeated wakes and failed deliveries. Small refills carry
  scheduling offsets so the initial 70/30 expansion/maintenance shares and the programme/programme/
  scholarship cycle remain fair across an entire epoch, including one-job fills.
- Completed jobs, newly available text and retry due times wake the same
  coordinator. Empty work, operator pause, budget/DB/provider waits, changed
  scope/catalog/revision and permanent unknown protections stop new dispatch.
  Alarms are at-least-once, so every notification and dispatch must be idempotent.

## Compatibility and data quality

- Continuous dispatch is opt-in. Disabled behavior preserves the existing
  scheduler, queue payloads and request hashes. One rollback flag returns
  ordinary dispatch to the existing 15-minute path without erasing history.
- New version-two jobs use smaller output scopes and complete source partitions:
  ten identities, eight field targets or five cycle targets. Existing v1 jobs
  retain their original payloads and keys. Contract changes do not authorize
  replay of old requests or protected source/snapshot aliases.
- Classify only errors at proven capture network/read boundaries as transient.
  Use bounded 60/300/900-second backoff; preserve unexpected errors and model
  uncertainty. Source rechecks use a separate authenticated, idempotent operation
  over at most five exact registered seed URLs and original held-capture tuples.
- A blocked or identity-pending school is not declared inspected or accepted.
  Existing official seed sources can be rechecked with independently retained
  attempts; normal rollout still requires real inspection evidence.
- Official years, language tracks, quotations and independent verification are
  unchanged. Identities, current facts and published opportunities stay distinct.

## Verification and rollout

Test capture floods with ready model work; real stage permits; one-job fairness;
duplicate/lost queue sends; coordinator restart; stale tuples and epochs; manual
pause; provider 429/529; quota resets; and preservation of unknown outcomes.
Use native D1/R2 and real migrations, in addition to deterministic unit tests.
Verify old v1 request bytes, source hashes and language/annual applicability.

After complete CI, deploy with continuous dispatch off, verify the same existing
database/buckets/model namespace/secrets, then enable a two-model pilot. Observe
15 minutes before raising the stage limit to four. Verify actual cloud dispatch,
provider attempts, output evidence and canonical publication readback.

Acceptance: with eligible model backlog and no quota/safety block, avoid
scheduler-created model idle time above 10% and target refill P95 below 15
seconds. Report window utilization alongside eligible backlog and wait reasons;
85–95% utilization is an optimization objective, not permission to manufacture
work or publish unsupported facts. Retain the existing five-percent margin,
independent-review reserve, no-PAYG fallback and current paid-service boundaries.
