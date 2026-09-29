# Data release review — 2026-09-29

The website keeps official programme and scholarship identities discoverable while
withholding expired application facts. This review covers every stored record's
structure, relationships and freshness; it does not claim that every official page
was newly read. Counts use the production publication gate for **2026-09-29 in
Asia/Shanghai**, independently reproduced from the current content files.

## Exact catalogue snapshot

| Collection | Stored records | Public records |
| --- | ---: | ---: |
| Universities | 272 | 266 |
| Programmes | 1,280 | 1,265 |
| Scholarships | 394 | 366 |
| Admission cycles | 865 | 14 |
| Cities | 62 | 62 |
| Official source records | 2,158 | 2,093 |
| Total | **5,031** | **4,066** |

The 14 public cycles cover 13 programme identities. The scorecard identifies eight
programme identities with an open, upcoming or rolling application state; a public
cycle does not by itself imply an open application. Eight programme profiles and
four scholarship records have fresh evidence. Zero records remain marked
`verified` after their review deadline. Schema and relationship validation passed;
all six content-file SHA-256 hashes match the saved audit.

Evidence: [comprehensive audit](../../quality/audit-2026-09-29-data.json),
[quality scorecard](../../quality/audit-2026-09-29-scorecard.json), and
[publication rules](../../src/lib/data/publication.ts).

The v1 release API uses a separate identity projection. It exposes 743 cycle
identities (729 stale and 14 current) and 2,094 source records, with the same
university, programme, scholarship and city counts. The additional source is
`src-program-sjtu-autumn-2026-calendar`. A cycle identity count is therefore not
the number of current application opportunities. Dynamic cycle dates, fees and
narrative notes are withheld when their evidence expires; identity, academic year,
intake and official-source history remain traceable.

## Official review and changes

The September 28 review changed 163 overdue records to `stale` without advancing
their actual evidence dates. It rechecked nine existing cycles and added four new
SIGS cycles. September 29 added the exact Tianjin University one-year foundation
cycle, bringing the current public total to 14. Seven programme profiles were
renewed on September 28 and one on September 29; four scholarship records were
renewed. Changes to stale discovery links do not renew fees or requirements.

Fifteen recorded manual source reviews are supported by 19 successful official
page/PDF captures across both days. The additional captures include exploratory
guides; capture success alone did not promote their facts. Every receipt's local
snapshot exists and its SHA-256 checksum matches. Full field locators, conclusions
and before/after changes appear in the
[September 28 change log](../../quality/audit-2026-09-28-data-changes.json) and
[September 29 change log](../../quality/audit-2026-09-29-data-changes.json);
capture details appear in the
[September 28 receipts](../../quality/audit-2026-09-28-data-source-receipts.json) and
[September 29 receipts](../../quality/audit-2026-09-29-data-source-receipts.json).
Receipt body paths refer to the operator's temporary capture directory.

The renewed existing cycles cover HIT winter study; XMU spring language study;
Tsinghua spring/autumn visiting study; and spring ICLT routes at Fudan, BLCU,
GDUFS, SISU and SZU. Independent September 29 primary-source spot checks confirmed:

- [SIGS 2027 admissions](https://www.sigs.tsinghua.edu.cn/_t195/2026/0918/c7769a293366/page.psp):
  programme codes 0830J2, 0812J3, 085700/Green Environmental Infrastructure and
  125604/Logistics Engineering and Management match the four inserted cycles.
  Annual tuition is CNY 40,000 / 40,000 / 62,000 / 30,000; the application fee is
  CNY 800. Applications close **15 May 2027, 17:00 Beijing time**. Programme-specific
  language and eligibility fields remain unrenewed; the fee table's other tracks
  are not used as substitutes.
- [TJU 2027 foundation guide](https://sie.tju.edu.cn/en/xwxm/FOUNDATIONPROGRAM/202609/t20260920_324704.html):
  Program 2 is one year, entering September 2027, with a 15 March–15 July 2027
  application window, CNY 28,900 total tuition and CNY 500 application fee.
  HSK 3 or at least one year of Chinese study applies to this route. The separate
  spring semester route is not merged into it; teaching language remains unknown.

## Links and map provenance

The original full link audit checked 1,597 distinct URLs: 1,400 accessible,
14 confirmed HTTP 404 and 183 inconclusive. The bounded follow-up checked all
183 warnings plus the new SIGS page: four original warnings recovered, SIGS was
accessible, and **179 responses remain inconclusive**. Blocks, timeouts and
connection failures are not treated as evidence that an admission fact is false.
See the [original results](../../quality/audit-2026-09-28-links.json) and
[follow-up results](../../quality/audit-2026-09-28-links-followup.json).

TJU and Hainan discovery/instruction links were replaced using current official
guides; five confirmed-dead SICNU/BIPT application fields were cleared without
guessing replacements. A trace of all 14 confirmed-broken URLs through
`selectPublishedData` found **zero public `admissionsUrl`, `applyUrl` or
`applicationUrl` values** pointing at them. Historical supporting-source and
stale programme-document URLs still include known failures and remain a follow-up
queue, not evidence of current application availability.

Twenty-seven cities have stored coordinate pairs; 35 remain unlocated and must
stay searchable in the list. Existing pairs pass bounds checks, but no
coordinate-specific source, coordinate system or precision is recorded, and this
audit did not independently re-geocode them. Pins represent approximate city
locations, not university campuses; the six-language UI describes catalogue
locations without claiming newly verified coordinates. See the
[coordinate provenance inventory](../../quality/audit-2026-09-29-city-coordinate-provenance.json)
and [map service record](../map-compliance.md).

## Remaining release limitations

The scorecard passes three of 14 improvement targets. There are 2,473 stale
records, 2,131 source records awaiting monthly review, 82 stale cycles whose dates
could still appear actionable, and two documented source conflicts. BFSU's
spring intake/deadline conflict remains withheld; SZU's Chinese/English HSKK
conflict leaves its programme requirements stale; SISU's spring opening date is
unconfirmed. The SIGS 17:00 cutoff is retained in notes because the schema stores
calendar dates. These are explicit limitations, not freshly verified facts.

The cloud snapshot was not promoted. The saved September 28 assessment
(`.pipeline-build/catalog-review-2026-09-28/assessment.json`, ignored local
artifact) rejected release
`catalog-release-materialization-885700cd9128f2de4173d9c39725066bd5170c4cb00192b52ad06f6b94dad528`:
**1,989 blockers** comprise one old snapshot, 1,966 missing identities, two
evidence regressions and 20 erased fields. Its release date is 2026-07-26 and its
bundle contains only six universities and zero cycles. Website publication must
continue using the audited JSON catalogue. The
[cloud observations](../../quality/audit-2026-09-28-cloud-observations.json) captured
heartbeats but six other queries failed at the CLI; they do not establish complete
pipeline health. See also the
[deployment input audit](2026-09-28-vercel-release-inputs.md).

Independent checks completed: `DATA_VALIDATION_DATE=2026-09-29 npm run validate:data`,
freshness/public-count reproduction, six content-hash comparisons, 19 receipt-body
checksum comparisons, and known-broken application-route tracing. Integrated
application tests, deployment SHA, stable alias and post-publication smoke checks
belong in the final website release report.
