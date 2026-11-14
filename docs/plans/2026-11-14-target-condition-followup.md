# Follow accepted identities into evidence-backed conditions

The 2055 catalog contains 2,252 programs and 1,654 cycles. Today's 84 accepted
identities are all NENU: 67 masters/doctoral identities from M-D.pdf and 17
bachelor identities from the undergraduate catalog. They have no populated
language, duration, application route, language requirement, eligibility or
cycle. Identity publication is useful directory growth, not 84 complete programs.

Identity extraction intentionally excludes these facts. Field maintenance and
cycle discovery are separate two-pass, citation-checked producers; canonical
import is the only publisher. Their optional field paths are already sent in
full, so absent scheduling metadata does not itself exclude missing fields.
However, the target-refresh completion path previously did not create follow-up
jobs. Jobs were only created by capture, whose next due date can be 168 hours
away. New targets therefore missed the already available capture.

The fix records only new target identities, changed identity/year/track scopes
and additional source bindings in a content-addressed plan. The original target
transaction atomically commits the plan reference with its completion event.
Unfinished exact pins can transfer to a newer catalog's plan; unrelated old
targets never enter. Old target plans remain compatible.

The normal scheduler seeds at most eight source batches of twenty exact pins
per tick, rotating across schools. It requires current enabled controls and
native-head admission, the current scope/catalog/seed/legacy guard pins, an
enabled source and same-scope/canary owner, a real successful observation no
older than 24 hours, the source's current raw/snapshot binding, and reread raw
and text checksums. Existing unknown reservations and permanent source/raw/text
STOP guards retain their meaning. A late pause, source capture or scope/catalog/
target change aborts the complete job-insertion batch. A bounded R2 ETag cursor
merges completed groups; lost replies repeat deterministic INSERT OR IGNORE jobs,
never change request keys or reclassify model outcomes.

The existing queueExtraction helper is reused with a private exact-pin mode that
omits identity extraction. It creates normal durable field/cycle jobs, not queue
deliveries. Existing 8/16/32 dispatch, school fairness, program/award 2:1 sharing,
model concurrency, provider quota and the single publisher remain in control.
No fact, source observation date, catalog record or existing unknown is edited.
This runs on the paid target; it does not claim a free-tier query budget.

This fixes future incremental target refreshes. It cannot retrospectively call
the 84 already-installed targets "new". Their exact follow-up requires a separate
explicit backfill using the two real published ACK/canonical/identity receipt
chains, immutable export evidence and current target/source pins. No arbitrary
record/source list or direct job update is an acceptable substitute.

There is also a distinct evidence limitation. The verified M-D text
`b6d4d7aa...` (38,843 bytes) is a 2026 program table: it has language, duration and
annual tuition columns, but no application deadline, application URL or admission
eligibility clauses. Its mixed language rows need trustworthy row/column evidence;
the current conservative language validator must not infer a language from its
directory title. The 84 targets currently link only their identity PDF. Normal
official-guide discovery and explicit same-year/program/degree/track applicability
are still required for common conditions and an admission cycle. Reusing a
snapshot does not fabricate those relationships or make a closed 2026 intake
current. Missing evidence remains held and does not count toward five complete
distinct programs per school.

The fixed registry already seeds NENU's official Bachelor_Program.htm,
Master_s_Program.htm and Doctora_Program.htm guide pages. Their URL/category is
an acquisition lead, not evidence of current-year clauses. The 84 PDF identities
do not currently link these guide sources. Discovery inheritance goes from a
child source toward its parents, so a parent guide does not automatically gain
the programs discovered in its child PDF. A separate explicitly scoped source
association/discovery step is needed. The locally retained old 93-source export
contains no usable NENU guide text; its BA2026xin.pdf text is also permanently
protected by a legacy unknown policy and must never be reused to bypass it.

Verification uses the actual producer/target-refresh/scheduler flow in SQLite,
including stale/future or absent observations, tampered bytes, pause/canary,
unregistered unknowns, late control/source/target changes, late unknown/reserved/
send-started states, lost progress writes, and cross-catalog carryover. A separate
native Miniflare D1+R2 test executes the real helper and insertion batch: healthy
evidence commits two ordinary jobs, while an unknown or started send introduced
at the atomic boundary rolls back every job and leaves the original outcome
unchanged. Its complete 23-binding guard also compiles with native EXPLAIN.
Models, queue sends and outbound requests are forbidden in that test.
