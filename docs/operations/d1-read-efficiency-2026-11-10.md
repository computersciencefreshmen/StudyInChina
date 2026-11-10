# Reducing shared database work for cloud catalogue maintenance

The MiniMax maintenance service already has a cloud scheduler and a registered five-school trial. Its database model flag is enabled, but the actual active Worker's deployment-level `MAINTENANCE_ENABLED` variable is false. November 10 scheduled receipts also show D1 daily-quota waiting. Adding another scheduler would not resolve these separate gates. The shared Pipeline database also serves ingestion, entity materialization and release preparation, so work in these services affects the resources available for coverage expansion.

## Observed work and changes

The [normalized seven-day query evidence](d1-read-efficiency-2026-11-10.json) comes from authenticated Cloudflare analytics, with parameter values omitted. The database-specific one-day query-insights response was empty; it cannot establish either zero reads or today's single cause. Separate database metadata reported 7,085,326 rows read in a rolling 24-hour window, which is not a UTC-day quota total.

| Query | Seven-day executions reported | Rows read reported | Change |
| --- | ---: | ---: | --- |
| Unreleased materialized candidates versus historical request members | 30 | 9,324,142 | Construct historical membership once per query, rather than once per candidate. |
| Latest complete-body observation for an immutable snapshot | 1,801 | 4,089,542 | Add a snapshot-leading time index; retain the existing source-leading index. |

The candidate selector retains every historical request regardless of publication status. Its explicit NULL handling preserves the previous `NOT EXISTS` behavior for legacy NULLs and JSON values. Ordering, limits and all publication guards are unchanged. The observation SQL and its 24-hour freshness/binary-file rules are unchanged; migration `0020_source_observation_snapshot_index.sql` only adds an index. Each new observation incurs a small additional index-write and storage cost.

The real-SQLite regression tests call the actual TypeScript selectors and compare results with the previous SQL. They cover failed/building/published request history, empty sets, NULLs, duplicates and other JSON values, deterministic ordering/limits, observation fallback, the exact 24-hour boundary and preservation of original timestamps. A 1,002-decision / 50-request / 20-members-per-request synthetic comparison reduced approximate SQLite VM instructions from 2,149,000 to 22,300 with identical results. This is local execution work, not Cloudflare metered rows or Vercel Active CPU. Production savings require comparable post-deployment analytics.

## Rollout and remaining consistency work

The snapshot index benefits the existing ingestion deployment without redeploying it: its SQL is unchanged. The modified candidate selector is called by the entity-materializer Worker, which needs a reviewed version rollout. Preserve its current variables, bindings and triggers; record the old active version for rollback. Do not redeploy the legacy ingestion model configuration as part of this change. Apply only the reviewed additive index, rather than unrelated historical migrations.

Separately, the maintenance control's expected catalogue hash remains at the October 25 Git snapshot while native Git imports have advanced the catalogue. A real prepared twelve-proposal export still belongs to that old head. The authenticated control row, archived export, historical Git snapshot, dedicated school/programme receipts and later native receipt chain have been audited separately. Head consistency must be repaired with revision checks, immutable audit evidence and explicit treatment of the existing export; changing a hash or fabricating an applied/publication acknowledgement is insufficient. Prepare the reconciliation with the deployment gate unchanged and the control paused. Only after the new targets are complete should the deployment gate be explicitly enabled, followed by a revision-checked restoration of the original control settings.

The existing subscription reserve, unknown-request protection, independent evidence checks, strict importer, staged rollout and protected public publisher remain required. A complete operational pass needs actual bounded dispatch, model/accepted-candidate receipts and a published coverage increase. A green cron, a deployed Worker, a local query speedup or a quota reset alone does not prove that outcome.

Cloudflare documents the distinction between sampled query analytics and individual-query row metadata in its [D1 metrics guide](https://developers.cloudflare.com/d1/observability/metrics-analytics/).
