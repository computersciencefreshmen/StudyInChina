# Bounded cloud dispatch configuration

Increase the supply of durable work without changing model admission. A single
strict `TICK_JOB_LIMIT` parser permits 8, 16 or 32, defaults to 8 and treats every
other string as the old default. Both source planning and ready-job selection
use this same bound. Existing candidate SQL reservoirs, ordering, share borrowing
and cross-school rotation remain unchanged. Scheduler receipts retain actual
successful queue sends and events additionally report the configured job limit.

32 fits the 40-source, 40-per-lane and 120-total candidate reservoirs. Existing
SQL bind counts and the bounded school metadata do not grow with this setting.
Capture INSERTs and queue bookkeeping remain individual durable operations:
the opt-in upper bound is suitable for the current Paid account, not a claim that
a 64-write tick fits Free's 50-D1-query invocation limit. No billing or account
setting is read or changed by this feature.

Keep the 15-minute scheduler, queue consumer limit, four-model concurrency,
5%/20% quota protection, unknown ledgers, provider429 cooldown and publication
writer fence intact. Do not dispatch a model directly from the scheduler.
Use real local SQLite/queue fixtures to verify the actual cloud tick sends at
most the selected bound, low-coverage schools rotate, expansion/maintenance and
programme/award shares remain intact, empty shares are borrowed, and invalid
configuration preserves the old eight-job behavior. No cloud operation is part
of this implementation.
