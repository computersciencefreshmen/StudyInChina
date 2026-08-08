# StudyInChina data maintenance runbook

## Operating model

The public website is a versioned publication surface. Official university pages,
admission notices and scholarship guides are the source of truth. A record is
published only after schema, provenance, freshness and deadline gates pass.

The maintenance loop has five layers:

1. `program-fact-refresh.yml` builds a fresh review queue from every current
   Catalog program, checks all registered official URLs weekly, keeps at least
   five seconds between requests to the same domain, validates changes and
   commits only verified facts.
2. `official-catalog-harvest.yml` checks the specialised high-volume HTML/PDF
   harvesters weekly and monthly. Its R2 upload total is derived from the signed
   run manifest, so adding sources does not require changing a hard-coded count.
3. `data-health.yml` audits freshness daily, source/link health weekly, the full
   Catalog monthly and semester readiness twice a year. It creates or updates a
   GitHub issue when action is required.
4. `cloudflare-backup.yml` exports both D1 databases to private R2 every day.
   `cloudflare-restore-drill.yml` restores the monthly backups into isolated
   local D1 databases every quarter.
5. CI runs schema, provenance, deadline, API, Worker and production-build gates
   before any change is allowed to become the next Vercel release.

Run `npm run validate:maintenance` to prove that the schedules, dynamic queue,
rate limit, manifest-derived upload count and backup/restore jobs are still in
place. The check also fails if the current number of unique official program
URLs exceeds the scheduled weekly capacity.

## Required GitHub Actions secrets

The Vercel Git integration deploys `main` without an Action secret. Cloudflare
backup, restore and remote Pipeline import require these repository secrets:

```powershell
gh secret set CLOUDFLARE_API_TOKEN --repo computersciencefreshmen/StudyInChina
gh secret set CLOUDFLARE_ACCOUNT_ID --repo computersciencefreshmen/StudyInChina
gh secret set VERCEL_TOKEN --repo computersciencefreshmen/StudyInChina
```

Enter each value only at the hidden prompt. Never place a token in a command
argument, committed file, issue, log or workflow output.

`VERCEL_TOKEN` allows the successful main deployment to reassign the stable
`studyinchina.vercel.app` alias. The secret is injected only into the credential
gate and the `vercel alias set` step; checkout, URL validation, smoke tests and
other commands cannot read it. Until it is configured, the Vercel Git integration
can still build a deployment, but the alias workflow fails deliberately: a green
workflow must mean that the immutable deployment and stable alias were both
smoke-tested. A successful deployment and a successful stable-alias promotion
are therefore two separate signals.

When a successful Production deployment does not match the current `main` SHA,
the alias workflow remains a deliberate no-op and records a notice. When it does
match `main`, the workflow first validates the immutable Vercel deployment URL
and its `/api/v1/releases/current` response. Only a healthy candidate may receive
the stable alias; the same endpoint is checked again through
`studyinchina.vercel.app` after promotion. A missing token, invalid URL, failed
candidate smoke test, failed alias command or failed stable-alias smoke test is a
red workflow and requires operator action.

The Cloudflare token should be limited to the StudyInChina account and only the
D1/R2/Workers capabilities required by the workflows. `MINIMAX_API_KEY` remains
a Cloudflare Worker secret; it is not needed by the deterministic GitHub
refresh job.

## Weekly checks

- Confirm the Weekly official program fact refresh completed.
- Review its artifact for `fetch-failed`, conflicts and sources that no longer
  contain the program identity.
- Confirm Data health has no open daily/weekly issue.
- Confirm the Vercel deployment for the resulting `main` commit is Ready.
- Smoke-test `/api/v1/releases/current`, `/api/v1/programs` and
  `/api/v1/scholarships`.

## Monthly checks

- Verify every public dynamic record has a future `reviewAfter`.
- Review all deadlines inside the 45-day window and all recurring-rule cycles.
- Re-run source discovery for new program and scholarship notices.
- Confirm the daily D1 backup has both `catalog.sql.gz`, `pipeline.sql.gz` and
  a SHA-256 manifest; retain monthly copies for 12 months.
- Review infrastructure usage against the ¥60/¥80/¥95 cost thresholds.

## Adding a school

1. Register official admissions, catalog and scholarship sources.
2. Reconcile every official catalog entry as public, not individually
   applicable, stopped, unavailable or quarantined.
3. Store directions/tracks under one program identity; never multiply them into
   false independent programs.
4. Add cycle-specific or explicitly recurring-rule evidence for dates and fees.
5. Add English, Chinese and Russian public names and notes.
6. Add a regression test for IDs, official URLs, dates, fees and publication.
7. Run:

```powershell
npm run validate:data
npm run validate:maintenance
npm test
npm run build
```

## Incident rules

- A 403, CAPTCHA or access restriction is not bypassed. Quarantine the affected
  field and keep the official entry point.
- Conflicting dates or fees are blanked and marked for review; one source is
  never silently chosen.
- A past deadline is removed from public lists after the 30-day grace period.
- Failed AI extraction never creates a guessed value.
- Roll back by reverting the data commit or switching the release pointer to the
  previous verified release.
- Never infer a backup from a green setup step or a deployment from a Ready
  preview URL. A backup exists only after checksum verification and all R2
  uploads succeed; production promotion exists only after the stable-alias
  workflow completes both the immutable-deployment and stable-domain smoke tests.

Code and schedules can guarantee that failures become visible and that unsafe
facts do not publish. External execution still depends on GitHub, Vercel,
Cloudflare availability and correctly scoped repository secrets.
