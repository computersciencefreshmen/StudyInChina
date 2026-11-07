# Cloud CPU metering preflight

The existing local observation reads the authenticated free Vercel Usage UI. A cloud runner must instead prove that the existing Vercel team credential can read real machine-readable Active CPU quantities without Observability Plus. Browser cookies/session files must not be copied into Actions.

## Current state

`vercel-cpu-monitor.yml` is deliberately **manual-only preflight**, not an enabled recurring CPU monitor. A green preflight only means a response could be read and sanitized; the JSON `state`, real metric/unit and time coverage still require validation. Empty or denied data never means zero CPU.

The public repository uses the standard GitHub-hosted Ubuntu runner. No npm dependencies are installed for the preflight. The existing `VERCEL_TOKEN` is injected only into the collection step on reviewed `main`, for the repository owner's dispatch. The token may have write permissions for other existing release duties; this collector only performs the fixed metering read query.

## Run the free source check

After the reviewed changes reach `main`:

```powershell
gh workflow run vercel-cpu-monitor.yml --repo computersciencefreshmen/StudyInChina --ref main
```

Inspect the summary and the small, seven-day-retention `vercel-cpu-meter-access-<run-id>` artifact. It contains allowlisted quantity metadata only, no token, browser session, response headers, raw server error body, or gross-cost values.

The request reproduces the official Vercel CLI's native quantity query to `POST https://api.vercel.com/v2/billing/costs`, with explicit UTC start/end, `quantity`, a timeseries response, and product/region/project dimensions. It does not estimate CPU from an invoice amount. Its HTTP method is POST because this API accepts read query parameters in JSON; it does not purchase, change, or deploy anything.

## Decision gate

- A usable source must expose an identified Active CPU quantity, its actual unit, correct team/project scope and trustworthy time coverage. The provider's query timestamp is not proof that metering has finished ingesting.
- `401`, `402`, `403`, `404`, invalid/empty metadata, missing buckets, response-size/deadline failures and unknown units cannot pass the daily CPU budget gate.
- Do not enable a schedule, disable a working observation, or announce cloud CPU monitoring until the live source is proved.
- If proved, the next stage uses fixed observation boundaries, complete post-publication windows, persistent checkpoints and changed-incident-only GitHub Issues. Target the team's original **336 seconds/day**, with **360 seconds/day** as the upper reference; ignore the temporary courtesy boost when evaluating sustainability.
- The CPU optimization publication marker is `2026-11-07T05:41:05Z`. A legitimate later deployment does not reset the 72-hour window. Low traffic or the preceding suspension cannot establish optimization success.

GitHub Issues and failed workflow notifications are cloud-side, but delivery by email/mobile depends on the owner's GitHub notification preferences. No new notification service or paid infrastructure is required.
