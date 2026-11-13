# Account budget and D1 recovery

The owner approved Workers Paid's USD 5 base fee, a USD 10 total target, and
background suspension at an estimated USD 9. This is a project admission
control, not a Cloudflare invoice cap. Taxes, delayed charges, other fixed
subscriptions and traffic outside these workers can change the final invoice.
The deployment does not purchase or upgrade a subscription.

## Data flow

The existing 15-minute GitHub maintenance workflow refreshes a private R2
decision from Cloudflare's official current-period billable-usage endpoint.
Successful observations are cached for one hour. Each background entry point
independently checks the shared policy and decision before SQL, queue dispatch
or model work. An observation older than two hours cannot authorize work.

The monitor sums `ContractedCost` once across validated usage rows, then adds
the approved USD 5 base. It does not add cumulative totals again. USD 4 of
usage therefore triggers suspension. Empty, malformed, conflicting, unreadable
or unavailable billing results are unknown, never zero. The V1 API has no
documented billing-period end; a daily charge window is not a monthly reset.
A threshold suspension stays in place until explicit resume obtains a fresh,
under-threshold observation. Budget refresh never enables manual controls.

The canonical policy and observations live in the existing private snapshots
bucket. Immutable receipts and ETag compare-and-set preserve a concurrent
pause. GitHub artifacts expose only fixed policy values, states and receipt
references; account charges, raw financial responses and credentials are not
published there.

## Enable after deployment

1. Save an account-scoped **Account / Billing / Read** token as encrypted
   `CLOUDFLARE_BILLING_READ_TOKEN` on `studyinchina-catalog-maintenance`.
   Do not put this token in repository files or Actions artifacts.
2. Deploy maintenance and the five background workers below, preserving live
   variables and secrets. The five workers require `BUDGET_STATE_BUCKET`,
   bound to `studyinchina-source-snapshots`.
3. Dispatch **Catalog maintenance tick** with `configure_budget=true`.
   This installs the approved 5/10/9 policy. A missing or unknown first
   observation immediately holds background work; verify `budget.json`.
4. In Cloudflare **Manage Account / Billing / Billable Usage**, create owner
   email budget alerts at USD 3 and USD 5 of usage, approximately USD 8 and
   USD 10 including the approved base. Verify the saved alerts. Alerts alone
   do not suspend service and can arrive after usage has accrued.
5. Verify a real official billing observation and every background gate before
   purchasing the paid plan. If billing access is unavailable, keep the hold
   and resolve access rather than treating unknown costs as free.

Without an installed policy, existing deployments retain their previous
behavior. Once installed, missing or invalid observations fail closed.
Do not delete the policy or observation to resume work. Dispatch with
`resume_budget=true` after the underlying cause has been reviewed; that action
still cannot resume above the threshold or without current billing evidence.

## Covered execution paths

| Worker | Gated work | Kept independent |
| --- | --- | --- |
| catalog-maintenance | tick, queue, model admission, business writes | health, budget diagnostics, explicit recovery and publication acknowledgements |
| ingestion | cron, queue, enqueue | health and read-only diagnostics |
| localization | cron, queue, batch submissions including dry runs | health and read-only summaries |
| entity-materializer | cron | health |
| publisher | cron and queue | health |
| release-builder | cron and queue | health and readiness |

Held queue messages request a delayed retry rather than reporting completion.
Ingestion records a small R2 recovery marker before retry: after admission
recovers, bounded scheduling can redispatch the original durable job only if
it is still queued and has never started. Queue delivery exhaustion therefore
cannot strand that work. Maintenance frontier continuations and target-upload
control messages also retain exact R2 pending envelopes until a later admitted
tick redispatches them; other maintenance work already has durable rescheduling.
Existing unknown model outcomes, reservations, leases and manual pauses retain
their original protections. Public catalogue reads and the website are outside
this background admission gate.

## Recover after a paid-plan change

A plan change does not invalidate the saved D1 daily-quota wait by itself.
Dispatch `recheck_backend=true` only after the account change: the authenticated
operation proves an actual control read, writes a dedicated audit event and
reads it back, archives the prior wait, then replaces only its observed R2
version with a checksum-bound recovery receipt. A newer wait wins a race.
Failure leaves the wait intact. Budget admission and operator controls remain
independent, so this probe cannot enable processing on its own.

Ingestion installs the three fixed 0023 lookup indexes before its next normal
heartbeat, only when the backend is available. The DDL is idempotent and its
completion receipt is written after the atomic SQL batch succeeds. A valid
quota wait suppresses SQL and repeated installation attempts. This reduces
unnecessary scans on either the free or paid plan; real savings must still be
measured from production query statistics.

Official references: [budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/),
[billable-usage V1 API](https://developers.cloudflare.com/api/resources/billing/subresources/usage/methods/get_account_usage_v1/),
and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).
