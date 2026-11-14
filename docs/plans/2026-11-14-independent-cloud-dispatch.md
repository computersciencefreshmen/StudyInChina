# Ordinary dispatch without waiting for publication CI

The existing GitHub tick and publisher shared a workflow-level concurrency
group. A publisher waits up to 30 minutes for candidate CI and another 30 for
stable publication. The default single pending slot can replace waiting ticks
even with cancel-in-progress=false. Raising dispatch from 8 to 32 does not fix
time spent waiting for this lock. `queue: max` would retain more waiting work,
but would not provide an independent 15-minute scheduler.

Retain the sole existing cron, `11,26,41,56 * * * *`, and use job-level locks:

- `operator`: manual configure/resume/budget-check/backend-recheck in their
  original order under the canonical writer lock. Failure/cancellation blocks
  that run's dispatch. Scheduled runs skip this job immediately.
- `dispatch`: depends only on operator success or skip, with its own serial
  dispatch lock. Refresh the budget, observe quota independently, request
  dispatch_only, collect ordinary status and durable receipt.
- `canonical`: waits for dispatch success and an allowed budget, then holds
  the existing publisher/reconcile/legacy writer lock for target/scope/coverage,
  administrative_only continuation and rollout. A waiting canonical job cannot
  hold the dispatch job of the next scheduled workflow.

Server modes are explicit. Dispatch-only never reads/resumes administrative
pointers, drains administrative held messages, seeds, activates controls or
changes the catalogue. The repository re-reads current control and returns
zero work before any metadata branch when seed or targets are incomplete,
including a readiness change between the runtime and repository reads.
Administrative-only retains those continuations but never dispatches an
ordinary source/job batch. Default/full remains compatible for old callers.
Its receipt uses a separate administrative prefix and does not replace normal
runtime health or add a second sample to seven-day cadence evidence.

An old Worker ignores POST /tick bodies. New isolated clients therefore first
read authenticated GET /tick capability metadata (no D1/R2 access), and send
nothing unless explicit mode support is proved. Submissions use distinct POST
/tick/dispatch and /tick/administrative paths, which old Workers reject with
404 even if a new-version GET was followed by an old-version POST during a
rollback. There is no fallback to POST /tick. Responses also bind the mode.

The ordinary job still uses TICK_JOB_LIMIT=8/16/32, and ordinary dispatch writes
only runtime jobs/leases/rotation/events. Existing model concurrency, quota,
budget, unknown/no-replay, source and record pins remain unchanged. Queue work
already progresses asynchronously during publication today; concurrent
publication can still make pins stale, which existing claims/import guards
must reject. No second Cloudflare cron, new timer or model send is added.

Tradeoffs: checkout/npm setup is repeated in the short canonical job; canonical
maintenance may still wait or have a pending job replaced, and the workflow's
overall result may lag its completed dispatch job. A target refresh may leave
ordinary dispatch correctly waiting until the canonical lane runs. This removes
publisher-induced scheduler starvation, not GitHub schedule delays or a promise
of 32 models/15 minutes. Administrative work retains its existing independent
bound (up to eight held continuations or one bootstrap/scope/target delivery).

Verification uses actual SQLite readiness races and bootstrap Queue parsing,
real workerd/D1/R2 mode/authentication with zero external requests, old-client
capability rejection before POST, workflow dependency/lock tests, and the full
maintenance regression suite. Live scheduling behavior requires observation
after a separately approved deployment; local tests are not production growth.
