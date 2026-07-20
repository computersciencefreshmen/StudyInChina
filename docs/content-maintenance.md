# Content maintenance

StudyInChina is useful only when a prospective student can tell **which intake a fact applies to, where it came from, and when it was checked**. All admissions facts are therefore changed through a reviewed pull request. Scheduled automation reports risks; it never scrapes, guesses, or publishes facts.

## Source policy

Use sources in this order:

1. The university's official international admissions or program page.
2. The scholarship provider's official page, such as the China Scholarship Council or the university itself.
3. An official national, provincial, or municipal government page.
4. A current official prospectus or notice published by one of the organizations above.

Aggregators, agency pages, social posts, blogs, cached copies, and search snippets may help locate an official source, but they are not sufficient evidence on their own. When two official pages conflict, keep the published record marked `stale` (or leave the new value unpublished), link both sources in the PR, and request a second review. Never resolve a conflict by choosing the more attractive deadline, fee, or scholarship coverage.

Store the official link in the source collection and reference its permanent source ID from the affected records. Every time-sensitive record must include:

- the academic year or intake it covers;
- `sourceIds` pointing to the evidence;
- `verifiedAt`, set to the day a maintainer opened and checked the official source;
- `reviewAfter`, set to the next deliberate review date; and
- an honest `status` (`draft`, `verified`, `stale`, or `archived`).

If the new cycle has not been announced, use `null` and `not-announced`. Keep an older cycle as an explicitly labelled historical reference; do not copy its date, fee, requirement, or scholarship terms into the current cycle.

## Pull request workflow

1. Create a focused branch and identify records by permanent ID, not by translated name.
2. Open the official source and confirm the academic year/intake. Capture its URL and publication date when available.
3. Change the smallest set of structured JSON records needed. Update the audit metadata in the same commit.
4. Update English first. Add or revise Chinese and Russian translations without duplicating dates, money, durations, or other language-neutral facts.
5. Run:

   ```text
   npm run lint
   npm run typecheck
   npm test
   npm run validate:data
   npm run build
   ```

6. Complete the pull request template and inspect the Vercel preview on desktop and mobile. Check the source link, locale switcher, displayed date/fee formatting, and application button.
7. Have a maintainer review both the official evidence and the rendered page before merging. A green automated check does not replace factual review.

Do not bundle unrelated universities or intakes into one correction PR. A small, source-backed change is easier to verify and roll back.

## Translation review

English is the base editorial version. English source text must exist before a record can publish. Chinese and Russian navigation, legal text, and core content require human review for the initial release.

Machine translation may produce a draft, but a person must check names, degree level, admission terminology, negation, numbers, and application instructions before the translation is marked ready. Do not translate university names or degree names when the institution provides an official version. Facts such as dates, tuition, application fees, duration, and language scores live once in structured data and are formatted with `Intl`; they must not be copied into translated prose.

German, French and Spanish form the first public expansion batch. Their navigation, core interface and legal copy must remain complete; missing record-level prose displays an explicit “Translation pending” English fallback and must never silently fall back to a different language. Arabic and Portuguese remain private preview locales until navigation and legal pages are 100% complete, core content reaches 95% coverage, and Arabic passes an RTL layout review.

## Review cadence

- **Daily:** the scheduled freshness gate checks verified records against `reviewAfter`. An overdue verified record fails the run; overdue programs, cycles and scholarships are excluded from current production data, while stable university and city profiles are labelled `stale` at runtime.
- **Weekly:** the scheduled Data Health workflow checks links and audit dates. Confirmed 404/410 responses are hard failures. A 403, 429, timeout, or network error is a warning requiring a later manual check, not evidence that a fact is wrong.
- **Monthly:** a dated Data Review issue is created on the first day of the month for records whose `reviewAfter` date is due, missing sources, and application or scholarship deadlines within 45 days. Give deadlines within 14 days priority.
- **Publication gate:** a verified program, admission cycle or scholarship may not set `reviewAfter` more than 31 days after `verifiedAt`. The data schema rejects a longer window, so current admissions facts cannot silently skip the monthly review queue.
- **January and August:** scheduled semester audits perform a broader review for spring/autumn intakes and newly published annual scholarship notices.
- **Before each release:** manually open all new application links and verify every changed deadline, fee, language requirement, and scholarship term against its cited source.

All four modes can also be run manually from the Actions tab. They report or fail safely but never alter content.

## Data Health reports

`scripts/check-links.mjs` scans HTTP(S) values in `content/data/*.json`. It tries `HEAD`, then a ranged small `GET`, with bounded retries and timeouts. `scripts/data-health.mjs` combines that result with `verifiedAt`, `reviewAfter`, deadline, source-reference, and status checks. The workflow updates one open `[Data Health] Content review` issue and uploads the complete machine-readable reports.

The report is advisory except for the daily overdue gate and confirmed hard link failures, which fail their workflow. Maintainers must still open the cited official page and submit a normal pull request to make a correction. Workflows and bots must never:

- update a deadline, fee, requirement, scholarship, program, or application link;
- promote `draft` or `stale` content to `verified`;
- copy a previous cycle into a new cycle; or
- publish machine translations without human review.

If a university site is temporarily unavailable, leave the fact unchanged, retain its last verified date, mark it for follow-up, and document the outage in the PR or Data Health issue.
