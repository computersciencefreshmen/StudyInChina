# Live CPU observation after the November 7 release

On November 10 the authenticated free Vercel Usage console was read directly, using explicit Shanghai-day time ranges and the All Projects / Projects view. This is actual platform Active CPU, not HTTP latency or a local benchmark. No paid observability feature was enabled. The website main remained `6b54d95` during these observations.

| Shanghai period | StudyInChina CPU | Approx. team CPU | StudyInChina function invocations | Team invocations | Window |
| --- | ---: | ---: | ---: | ---: | --- |
| Nov 7, 13:41–24:00 | 2m 55s | 2m 55s | 3,448 | 3,448 | Post-release partial day |
| Nov 8 | 5m 30s | 5m 31s | 6,650 | 6,651 | Complete day |
| Nov 9 | 4m 38s | 4m 44s | 2,351 | 2,420 | Complete day |
| Nov 10, 00:00–11:27 | 2m 26s | 2m 28s | 679 | 691 | Incomplete day |

CPU durations are rounded display values. Team durations are sums of the displayed nonzero project rows, not higher-precision team totals. The complete days were also read with their end at `23:59:59.999` to exclude the next midnight; the displayed results were unchanged. Function invocations exclude CDN cache hits; they are not visitor counts.

## Budget interpretation

Both complete days meet the original team target of 336 seconds/day at the UI's precision. November 8 has only about five seconds of headroom. Their approximate mean is 307.5 seconds/day (5m 7.5s). If the same daily workload continues, `30 × 307.5 / 3600 = 2.5625` CPU-hours per 30 days, below four hours and the 2.8-hour target after a 30% reserve.

This does **not** establish stable capacity at the earlier load. StudyInChina had 6,650 and 2,351 invocations on these days, versus the historical examples of 17,966 and 29,639. Its CPU per thousand invocations was approximately 49.6 and 118.2 seconds. That variation can reflect routes and initialization as well as other work; no route breakdown or cold-start share was observed. Do not attribute the entire drop from approximately 40 minutes/day to the optimization, or linearly extrapolate a single CPU/request number across another traffic mix.

Only two full Shanghai days after deployment are present at this readback time. Partial days, sparse traffic, missing data or the prior suspension cannot prove a daily budget pass. The existing rolling-month accumulated usage is not reset by this forecast. Continue to evaluate the original allowance, not the temporary threefold courtesy boost.

## Evidence

The committed [normalized readback](fluid-cpu-evidence/usage-2026-11-10.json) records periods, metric units, project rows, counts and uncertainty. Private raw visible console text and exact dashboard URLs remain in `.tmp/cpu-coverage-2026-11-10/usage-ui.json` and `complete-days-ui.json` in the independent working clone. No browser session, cookies, token or billing amount was exported.

The separate cloud metering preflight remains unavailable and unscheduled; this manual readback does not mean that unattended monitoring has started.
