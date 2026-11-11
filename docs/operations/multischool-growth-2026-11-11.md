# Multi-school programme and scholarship expansion

## Goal and measurement

The first delivery goal is five distinct, current, application-ready programmes
per school with official international-admission evidence. Language tracks and
rounds retain separate conditions but do not inflate the distinct-major count.
Schools with fewer official programmes require an actual catalogue reconciliation;
unknown or blocked sources are not evidence that a school has no programmes.

The 2026-11-11 baseline at main `f00ebb7` contains 295 raw schools, 2,168 programme
records, 1,654 admission cycles and 400 scholarship records. Accepted directory
identities are 278 schools, 1,004 programmes and seven awards. Record-current
facts are 751 programmes/cycles at five schools and zero awards. These are Git
data/projection counts, not a live production-readback claim.

The stricter five-programme objective also requires an application route,
teaching language, duration and evidenced language/eligibility requirements.
See [the dated coverage report](coverage-295-2026-11-11.md) for the deduplicated
baseline and per-school gaps; raw records are not interchangeable with this KPI.

## Continuous acquisition and publication

Official HTML/PDF/OCR -> immutable R2 evidence -> MiniMax extraction and independent
review -> typed proposals -> protected GitHub importer -> CI -> canonical commit
-> deployment -> exact stable-domain publication acknowledgement.

The existing quarter-hour cloud tick now continues the approved additive 295-school
scope upgrade and refreshes date/catalogue-bound coverage metadata without rewriting
all record targets. The existing document and publisher schedules remain in place.
No second writer, database, Cron slot or paid plan is introduced.

Within the existing finite pools, low-coverage schools are prioritised as
0, 1, 2-4, then 5+ current distinct programmes. Expansion uses programme/programme/
scholarship rotation with immediate borrowing of empty shares. Review expiry also
advances actual source capture, never a record's evidence dates. Coverage from a
different catalogue/date/scope is unavailable, not zero.

## Database changes and measured costs

Wrangler D1 Insights was read on 2026-11-11 for a rolling one-day top-20 query
sample. It reported 5,410,720 scanned rows across the sample; this is neither the
UTC daily total nor remaining account allowance. Major maintenance hotspots were:

- Legacy guards: 2,519 rows per call, 272 calls, 685,248 scanned rows.
- Record-ID target lookup: 4,129 rows per call, 86 calls, 355,094 scanned rows.
- Due-source scheduler: 277,432 scanned rows over 19 calls.

Migration 0021 adds only scope-upgrade cursors/receipts. Migration 0022 adds six
lookup indexes. Both were applied to the existing Pipeline D1 on 2026-11-11:
0021 read 1/write 4 rows; 0022 read 39,902/write 19,454 rows during index creation.
Existing guards, source evidence, targets and model attempts were not deleted.
The changed legacy-guard query filters by school and expanded record scope while
preserving global/null guards and raw-snapshot aliases. Real post-deployment
savings must be measured; a query-plan test alone does not establish the savings.

Use `node --import tsx scripts/cloudflare/report-d1-costs.ts --output <report.json>`
to save a portable hashed-query report. It contains no SQL text, bound values or
credentials and never presents a top-query sample as a quota balance.

Proven daily exhaustion is cached in R2 until the next UTC reset. Ticks, status
checks and Queue deliveries reuse that wait across isolates. SQL/auth errors do
not become quota waits. At reset an actual backend observation is attempted again;
manual controls are preserved and no model request with an unknown outcome is replayed.

## Scope and compatibility

The immutable 272 registry is retained. The 295 v2 registry preserves every old
school/source registration byte-for-byte and adds 23 schools with 111 registered
official source seeds. Old exports use their own registry/hash. Scope upgrade uses
a content-addressed R2 intent, an idle/CAS fence and bounded Queue SQL continuations.
It preserves the seed, legacy guards, completed/unknown model attempts and original
operator flags. Target readback must finish before those original flags are restored;
a newer manual revision blocks automatic restoration.

The existing cloud tick can resume a pending upgrade after daily quota waiting
or local-machine shutdown. The 295 registry is an acquisition scope, not proof
that all schools admit international students or have complete catalogues.

Admission language/round isolation is documented in
[admission-language-tracks.md](admission-language-tracks.md). Legacy programme IDs
and v1 target-upload bytes remain stable. A deterministic-clock test repair
unblocks the protected publisher while an explicit expiry regression continues
to hide genuinely expired comparison facts.

## Runtime acceptance

Code checks and candidate acceptance do not mean a new public opportunity exists.
Count additions only after a published acknowledgement with its exact commit,
deployment and stable-domain proof. Track low-coverage school bands, effective
awards, earliest field review dates, held/unknown reasons and latest confirmed
publication. Do not count workflow success, captures or proposal totals as
published growth. No subscription purchase, PAYG fallback or account upgrade is
authorised by this change.
