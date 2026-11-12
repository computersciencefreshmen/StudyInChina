# Included MiniMax quota and school coverage

This is a focused implementation of the approved multi-school expansion plan.
The outcome remains at least five distinct concrete majors with evidence-bound
application conditions per eligible university. Language tracks do not inflate
that count. Scholarship discovery retains its independent one-in-three expansion
share. Raw identities, current facts, and acknowledged production changes remain
separate measures.

## Correct the allocation before raising concurrency

The existing four-model ceiling, reservation ledger, unknown-outcome protection,
exact publication writer, and fifteen-minute cloud schedule remain in place.
Increasing concurrency while the shared execution ledger is unavailable cannot
increase safe throughput. Two allocation errors can waste available quota even
after that backend recovers:

1. A source attempt does not prove school coverage. Expansion remains the larger
   normal share until a fresh catalog/scope-bound snapshot covers the exact active
   school set and every school reaches five complete distinct majors. Missing,
   stale, partial, or mismatched snapshots remain unknown.
2. A backlog entry does not prove urgent maintenance. The expansion reserve only
   applies to due, runnable, currently scoped maintenance with matching active
   target pins and snapshot. Explicit urgent priority or a current coverage
   review date supplies urgency. Future retries, expired leases, disabled sources,
   other canaries, and cycle discovery do not reserve the final expansion share.

School coverage bands and school rotation must apply before the bounded source
and job candidate limits. Otherwise a large source list from one university can
exclude schools before the final in-memory ordering runs. Sparse school metadata
is materialized once in SQL, bounded at 24 KiB, and large factual payloads are read
only after candidate selection. Existing source/job indexes must remain effective.
One scope-bound R2 scheduling hint preserves school rotation across ticks and
catalogue updates. It records dispatch age separately from real source attempts;
an ETag conflict permits one bounded merge/retry and cannot move ages backwards.

## Observe the provider independently

Authenticated `GET /quota` reads the official subscription remaining-quota API
using the Worker-held subscription credential. It does not query D1, admit a
model, schedule a job, mutate billing, or return credential values. The existing
quarter-hour workflow retains its report alongside actual backend status. A
diagnostic transport failure cannot block the scheduler; absent quota remains
unknown. Read-only quota observations are not evidence of new catalogue data.

The report includes validated five-hour/weekly windows and a strictly numeric
allowlist of provider schema observations. Missing, null, unexpected types, and
explicit unlimited status remain distinguishable without dumping raw responses.
The configured reserve is reported separately from unverified provider billing
settings. It never asserts that a configuration variable disabled account credits.

## Legacy subscription compatibility

MiniMax's official CLI defines weekly status `3` as unlimited. A missing weekly
percentage is therefore not necessarily exhausted quota. The unlimited branch
must be explicit and preserve null weekly amount/window values, while the real
five-hour window, low-balance margin, independent review, and execution ledger
remain enforced. Missing or malformed status must never be interpreted as
unlimited. A model with no plan entitlement must remain blocked.

References: [official quota type](https://github.com/MiniMax-AI/cli/blob/main/src/types/api.ts#L391),
[official quota renderer](https://github.com/MiniMax-AI/cli/blob/main/src/output/quota-table.ts#L88),
[legacy Token Plan entitlements](https://platform.minimax.cn/docs/m-plan/token-plan-notice).

## Verification and rollout

Use real SQLite fixtures to test large uneven candidate pools, cross-school
rotation, current and old scopes, all five-major boundary cases, source disablement,
and query plans. Exercise model admission around real urgency and percentage
boundaries, including legacy unlimited status and stale windows. Test `/quota`
against a throwing D1 backend and assert no queue, model, storage, or credential
side effects. Run focused checks and full CI before rollout, then retain an
authenticated quota observation and the actual runtime backend state. Do not
claim new application-ready records until publication and website readback agree.

Billing changes require separate explicit authorization. Workers Paid removes
the free D1 daily limit but introduces account-level recurring and excess usage
charges. No package is purchased or provider credit fallback changed by this code.
