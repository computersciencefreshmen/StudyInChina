# Cloud CPU Monitor Implementation Plan

**Goal:** Replace the local 72-hour CPU observation with a free, unattended cloud observation only after verifying a real CPU metering source.

**Architecture:** Use a standard GitHub-hosted Ubuntu runner in this public repository. The existing Vercel repository secret remains in GitHub and is injected only into a bounded read-only collection step. A successful runner or an empty response is never evidence of low CPU. Do not export browser sessions or use paid Observability Plus.

**Tech Stack:** Native Node.js fetch, GitHub Actions, existing Vercel team credential, existing GitHub Issues notification mechanism.

## 1. Prove the data source before enabling a schedule

- Create a small native Node script and a manually triggered `vercel-cpu-monitor` preflight workflow.
- Use the exact quantity request implemented by the official Vercel CLI: `POST /v2/billing/costs`, with explicit UTC range, quantity, timeseries, and project dimensions. This is a read-only query despite its HTTP method.
- Enforce an exact origin and path, no redirects, bounded time/response bytes, no credentials in output or artifacts, and no production website requests.
- Store only a fixed allowlist of response metadata and numeric metering fields. A denied, paid-only, missing, or malformed source is `unavailable`, not zero CPU.
- Start with manual preflight only. Merge reviewed changes through required CI, then test with the existing GitHub secret on main. Do not claim a cloud monitor exists merely because a workflow was added.

## 2. Enable observation only if the live preflight succeeds

- Validate the provider's actual CPU metric, unit, team/project dimensions, time bounds and time buckets. Do not infer CPU from cost or memory duration.
- Preserve the fixed publication marker `2026-11-07T05:41:05Z` and 72-hour observation deadline. Record later legitimate deployments without resetting the observation period.
- Compare complete post-publication 24-hour windows against the team's 336-second target / 360-second upper reference. Missing coverage cannot pass a budget check.
- Run a small scheduled collection with self-contained, validated artifact checkpoints. Never difference rolling 30-day totals.
- Create/update a single rolling GitHub Issue on a changed incident, with a stable fingerprint and acknowledgement-aware deduplication. Normal observations only produce artifacts/summary. GitHub delivery depends on the owner's notification settings.
- Stop the old local heartbeat and close its browser task space only after the cloud collection is actually verified. Do not create duplicate monitoring or a monitoring gap.

## 3. Validation and limitations

- Test transport destination/redirect/size/deadline constraints, malformed and denied sources, quantity metadata allowlisting, non-zero and zero distinctions, and secret redaction.
- If a usable source is proved, test CPU-unit conversion, budget boundaries, incomplete windows, late data, checkpoint trust and notification deduplication.
- Run required lint/type/CI checks appropriate to the committed changes. Test one real cloud collection with no notification side effect before enabling a schedule.
- If the provider cannot expose free machine-readable metering with the existing credential, preserve that evidence and report the exact limitation. Do not ship a pretend CPU monitor, upload login cookies, upgrade plans, or silently substitute uptime/latency checks.

## Rollback

Disable the dedicated workflow/enable flag and restore the previous local heartbeat if it had already been replaced. This feature does not alter admissions facts, receipts, expiry rules, Vercel plan or website rendering.
