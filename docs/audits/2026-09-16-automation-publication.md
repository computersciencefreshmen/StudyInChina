# Unattended entity materialization and publication — 2026-09-16

## Architecture and outcome

The data pipeline now separates evidence decisions from operational failure. Official pages first produce grounded candidates and reconciliation identities; deterministic entity materialization writes canonical facts; a transactional outbox requests an immutable release; the release builder stages, validates and atomically activates Catalog D1. The publisher handles existing exact field mappings through the same evidence requirements. Unknown mappings, conflicts and ungrounded AI output are never guessed or approved by retry machinery.

This work makes that existing path recover unattended after transient failures and missing cron deliveries. It does not by itself switch the public Next.js site from its JSON backend. Root integration owns the compatibility snapshot synchronizer, shadow parity checks, live backend selection and deployment evidence. An old/incomplete Catalog D1 cannot safely overwrite the richer JSON site.

## Implemented controls

### Durable retries and fairness

- Pipeline migration **0017_automation_retry_state.sql** creates independent operational retry state and scheduler heartbeats.
- Entity materialization filters cooldowns **before LIMIT** and orders candidates by their most recent attempt. A permanently unavailable dependency cannot monopolize every batch. Backoff begins at 60 seconds, doubles, and caps at six hours. Successful/terminal decisions clear retry state.
- Entity candidates keep the existing official evidence, registry, reconciliation, confidence and conflict checks. Exceptions do not create an approval decision.
- Recognizable transient publisher transaction failures release only the current promotion token's lease and preserve validated facts. Data constraints remain evidence/transaction isolation failures. Runtime queue exhaustion records a durable cooldown instead of quarantining verified evidence; cron rediscovers it after recovery. Successful promotion remains idempotent and clears retry state.
- Publisher and release scheduler dispatch failures are isolated per job; the remaining jobs are still attempted before reporting scheduler failure.
- Entity, publisher and release-builder crons run every 15 minutes. Entity cron also retains the dedicated daily trigger. Every regular entity pass can catch up a missed daily release, while the database's existing UTC-day unique window still bounds materialization release requests to one per day.

### Release safety and recovery

- Runtime failures retain a pending durable outbox even when the queue's immediate retry budget is exhausted. The exhausted message is acknowledged with a diagnostic DLQ entry; scheduled recovery remains active. Default cooldown is 900 seconds, configurable with **RUNTIME_RETRY_DELAY_SECONDS** (60–21,600 seconds).
- Immutable contract, artifact and validation errors remain terminal; they do not repeatedly consume every queue window.
- Failure updates use the executor's original lease token, never a newly read token belonging to another worker. Both the job update and outbox update are ownership-guarded.
- Before staging, automated releases must contain institutions and programs. They must retain every previously active school and program identity. Comparing identities catches destructive replacements even when total counts are unchanged.
- Announced admission cycles remain protected while their review evidence is current, their academic year/explicit end date has not passed, and at least one application window has not closed (or no window is known). Deadline comparison uses the **China calendar (UTC+8)**. Naturally expired cycles can leave the next release without weakening stable identity protection.
- A delayed snapshot cannot replace a more recently generated active release. Activation compares the active pointer with the baseline checked by the health gate in the same database operation, preventing a concurrent cutover from invalidating the comparison.
- Existing checksums, immutable R2 compatibility artifacts, per-table count validation, atomic activation and current-plus-two-rollback retention remain in force.

### Honest health reporting

All three scheduled entry points use the shared **withAutomationHeartbeat** helper. Runs record start, success and safe failure code in **automation_service_runs**. Entity partial runtime failures are reported after other candidates and release requests have been processed. Static /health remains process identity only; a successful heartbeat means scheduling completed, not that every source or fact is verified. Existing release-builder /ready continues checking active-pointer consistency and retention.

## Validation

- **47 worker tests passed** across entity-materializer, ingestion's entity-materializer suite, publisher and release-builder.
- New real SQLite tests cover exponential/capped backoff, fairness before LIMIT, transient-vs-constraint classification, exhausted publisher recovery with exactly one publication, durable release redrive, immediate contract isolation, stale lease ownership, equal-count identity replacement, empty/older releases, and a China-midnight admissions deadline.
- Modified worker directories and tests pass ESLint.
- TypeScript checks pass for all three worker projects.

## Deployment and remaining boundaries

Apply pipeline migration **0017** before deploying these worker versions. There is no new secret or provider requirement. The new release-builder cooldown variable is present in its Wrangler configuration. Deploying these three workers and the ingestion producer must preserve their D1/queue bindings; scheduled heartbeat readers must use the same pipeline database.

Automatic publication consumes the schemas and official evidence rules already supported by the system. Newly discovered pages can become verified directory entities, but arbitrary unseen page layouts do not authorize invented fee/deadline extraction mappings. Conflicts, uncertain identity, missing exact mappings and unsupported document structures remain visible unresolved states. This is a data-quality boundary, not a hidden manual approval on valid, supported records.

Protected school/program deletion has no trusted withdrawal contract in the current pipeline, so the release health gate blocks it. Supporting verified institutional/program withdrawal later requires an explicit, source-backed state transition rather than a count-loss threshold or an AI override.

Production deployment versions, live JSON synchronization and post-deployment evidence are recorded together in the root deployment report.
