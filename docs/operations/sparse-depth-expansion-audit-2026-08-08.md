# Sparse-school depth expansion audit — 2026-08-08

## Decision

This wave is approved for release as a conservative identity-and-reference expansion. It publishes 23 program identities and three scholarship identities from official university sources. It does **not** claim that it added an open application window: every new candidate is date-free, and the eleven materialized fee cycles are explicitly marked as reference-only.

## Why this wave exists

The public catalogue already covered 266 universities, but 17 had fewer than three published programs. A nationally broad directory is only useful when regional and specialist universities have enough representative options to compare. The wave therefore prioritised depth at existing sparse universities instead of adding more one-record institutions.

Baseline:

| Metric | Before |
|---|---:|
| Public universities | 266 |
| Public programs | 1,211 |
| Public scholarships | 355 |
| Universities below three programs | 17 |
| Scholarship-connected universities | 205 |
| Raw universities / programs / scholarships | 272 / 1,232 / 381 |

## Candidate and evidence audit

The reviewed package is [`quality/multiversity-expansion-wave-2026-08-08/sparse-depth-and-scholarships.json`](../../quality/multiversity-expansion-wave-2026-08-08/sparse-depth-and-scholarships.json).

- 23 program candidates and 3 scholarship candidates.
- 10 represented institutions; nine receive program depth and Guangzhou Medical University receives scholarship coverage.
- 33 official evidence URLs and 156 reviewed English, Chinese and Russian text fields.
- Zero non-HTTPS primary evidence URLs, non-allowlisted evidence domains, translation placeholders or generated-evidence template phrases.
- Zero candidate cycles, open-state claims, group-only routes, duplicate groups, quarantined candidates or dropped references.
- Candidate builder, integrator and materializer were replayed; the second pass produced stable hashes and counts.

Untracked MiniMax harvest packages were audited but were not treated as publication evidence. No record was safe to import directly. Two candidates that superficially passed structural validation contained generated template prose instead of source quotations; the rest failed schema, tuition or evidence requirements. They remain outside the release and were neither deleted nor silently promoted.

## Application-route correction

An official program page is not automatically an application route. Five initial values were removed because they pointed only to a faculty homepage, university root or overview:

- two Guangxi University records;
- two Zhengzhou University records;
- one Wuhan University of Science and Technology record.

The three Kunming University of Science and Technology records retain its exact official **2026 International Students Admissions** page. The underlying online system is HTTP-only, so the catalogue does not expose that insecure URL. Central South University, Ocean University of China and Southern University of Science and Technology retain their official HTTPS application systems.

## Published result

| Metric | After | Change |
|---|---:|---:|
| Public universities | 266 | — |
| Public programs | 1,234 | +23 |
| Public scholarships | 358 | +3 |
| Universities below three programs | 8 | −9 |
| Scholarship-connected universities | 208 | +3 |
| Public admission-cycle records | 356 | +11 reference records |
| Raw programs / scholarships / sources | 1,255 / 384 / 2,070 | +23 / +3 / +33 |

Target-school public depth is now:

| University | Published programs |
|---|---:|
| Central South University | 5 |
| China Conservatory of Music | 5 |
| Guangxi University | 4 |
| Kunming University of Science and Technology | 5 |
| Ocean University of China | 5 |
| Southern University of Science and Technology | 5 |
| Wuhan University of Science and Technology | 3 |
| Zhengzhou University | 4 |
| Zhongnan University of Economics and Law | 5 |

Scholarship coverage was added for Central South University, Guangzhou Medical University and Zhengzhou University. Every new scholarship has a null deadline because no safe current deadline was established.

## Dynamic-fact safety

Eleven programs contain an official tuition reference. All eleven records have:

- `opensOn = null`;
- `closesOn = null`;
- `dateStatus = not-announced`;
- `tuitionStatus = reference`;
- no rolling or open application claim.

The Zhengzhou University source prints an invalid “June 31” date. The condition is retained only as a non-public candidate risk flag for auditability; the value is absent from candidate cycle fields, formal cycle fields and all public output.

The platform scorecard currently counts date-free fee-reference cycles in `programsWithCurrentCycle`. As a result, the displayed percentage moves from 27.83% to 28.20%, even though this wave added zero dated or open application windows. That increase is a metric-definition effect and must not be described as improved deadline coverage.

Coverage after the wave:

| Field | Programs | Coverage |
|---|---:|---:|
| Duration | 760 | 61.59% |
| Official application route | 628 | 50.89% |
| Known teaching language | 1,050 | 85.09% |
| Requirements evidence | 74 | 6.00% |

## Remaining work and exclusions

Eight universities remain below three published programs: Tibet University has one; China University of Geosciences (Wuhan), Guangzhou Medical University, Guizhou Medical University, Hunan University of Technology and Business, Jiangxi Normal University, Wuhan Textile University and Zhejiang University have two each. Limited official catalogues at some institutions must be reconciled rather than filled with domestic-only records. Zhejiang University has draft candidates that still require source-level evidence.

The next collection queue should continue to exclude domestic catalogues, group-only routes, expired cycles, nationality-restricted opportunities outside their stated scope, invalid dates, HTTP-only application systems and generated evidence prose. Ocean University of China's image-only 2026/27 graduate scholarship notice belongs in OCR quarantine until its text and evidence locator are reproducible.

Current platform scorecard remains 3/14: 27/62 cities have reviewed coordinates, ten Source Manifests are registered, and no full reconciliation is complete. Publication anomalies remain at zero verified-overdue records and zero published cycles without any date semantics. Existing stale-source and historical-date health debt is not resolved by this wave.
