# MiniMax data quality audit — 2026-07-28

## Release decision

No MiniMax-generated record from the three inspected collection generations is
published directly. Raw outputs remain quarantined. This release imports only records
that were independently reconciled against official university pages or official PDFs.

The hardened v2 task validator now accepts 9 of 128 outputs and rejects 119. Passing
that task-level gate is necessary but is not sufficient for publication: record-level
official evidence, semantic checks and catalog reconciliation still have to pass.

## Current catalog and public release

| Layer | Cities | Universities | Programs | Cycles | Scholarships | Sources |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Stored catalog | 36 | 128 | 316 | 112 | 39 | 335 |
| Public website on 2026-07-28 | 36 | 127 | 284 | 82 | 16 | 329 |
| Public API identity projection | 36 | 127 | 287 | 82 | 16 | 332 |

The differences are intentional. The website opportunity view hides draft, stale,
unsupported or expired records. The API keeps three additional verified program
identities while masking their unavailable or expired cycle facts. Both surfaces
remove scholarship opportunities more than 30 days past deadline while retaining
them in the historical catalog.

## Scope inspected

| Layer | Schools | Programs | Scholarships | Main result |
| --- | ---: | ---: | ---: | --- |
| Catalog before this release | 120 | 283 | 24 | Structurally valid, but detailed facts were sparse |
| MiniMax harvest v1 | 169 | 226 | 115 | 0 direct-publish candidates |
| MiniMax expansion v2 | 77 | 125 | 0 | 9/128 task outputs pass the hardened structural gate; none imported directly |
| MiniMax recapture v3 | 28 | 39 | 0 | 0/56 produced outputs passed the strict recapture validator |
| Catalog after verified expansion | 128 | 316 | 39 | Schema-valid official-source release candidate |

## Current completeness

- 58/316 programs have a confirmed duration.
- 38/316 programs have at least one tuition value.
- 49/316 programs have any exact deadline.
- 41/316 programs have a deadline on or after 2026-07-28.
- 24/316 programs have structured language-test requirements.
- 207/316 programs still have no admission-cycle record.
- 12/316 programs currently combine duration, teaching language, tuition and a future
  exact deadline.
- No university is completely without a program, but 78/128 universities still have
  two or fewer programs.

Sparse facts remain explicitly unknown. They are not inferred from another program,
school, year or intake.

## MiniMax findings

### Harvest v1

- 45 JSON files covered 169 schools, 226 programs and 115 scholarship candidates.
- Only 14 program candidates contained all five core facts.
- 837 claimed known facts included 491 homepage citations and 31 search-result snippets.
- Raw snapshots were absent or template-like, so evidence could not be reproduced.

### Expansion v2

- 128 JSON files covered 77 schools and 125 program candidates.
- Although 60 records claimed publishable status, 161/330 facts relied on template
  evidence and 78/125 records were near-duplicates.
- Queue state was unreliable: 96/100 completed markers had no publishable output.
- After hardening task-type, duration, tuition, deadline, scholarship and evidence
  gates, only 9/128 outputs pass the structural validator.

### Recapture v3

- 102 tasks produced 56 outputs; 46 outputs were missing.
- The strict validator accepted 0 and rejected all 56 produced outputs.
- 22 program tasks cited a homepage instead of a program page.
- 17 scholarship tasks returned an empty set and 11 returned programs in a scholarship
  task.
- 71 HTML snapshots represented only 49 unique content hashes.
- Only 8/25 scholarship snapshots contained scholarship-related content.

## Root causes

1. Discovery selected domains and homepages, not record-level official pages.
2. Completion markers described task execution rather than validated output.
3. Evidence was frequently a copied template, search snippet or unrelated page.
4. Duplicate detection happened too late.
5. Program and scholarship task types were not enforced at the capture boundary.
6. Missing facts were filled optimistically instead of remaining unknown.

## Controls applied

- Only official HTTPS pages and official hosted PDFs are accepted.
- Every new verified program has a matching official program source.
- Identity-only records do not gain invented duration, tuition or language facts.
- Cycle facts state whether evidence is cycle-specific or a recurring official rule.
- Exact dates are published only when the official page states them.
- Route restrictions can be stored as localized cycle notes and are shown on cards and
  detail pages.
- Cash grants are not represented as tuition waivers.
- English, Chinese and Russian public names are present for every added entity.
- MiniMax v1/v2/v3 raw records remain outside the public catalog.

## Verified expansion in this release

Eight institutions were added:

- Guangdong University of Foreign Studies
- Shanghai Normal University
- Xi'an International Studies University
- Wenzhou Medical University
- Chang'an University
- Nanjing Audit University
- Wenzhou-Kean University
- Beijing University of Posts and Telecommunications

Official records were also strengthened for Beijing Language and Culture University,
Shenzhen University and Southern University of Science and Technology.

Relative to the 120-school baseline, the release adds 8 universities, 33 net programs,
23 admission cycles and 15 scholarship records.

Wenzhou-Kean University contributes five English-medium undergraduate programs with
2026-2027 tuition, application fee, language requirements and a Spring 2027 deadline.
Its spring route is visibly marked as transfer-only. Official source:
https://admission.wku.edu.cn/en/internationalstudents

Beijing University of Posts and Telecommunications contributes five English-medium
degree programs with official 2026 duration, tuition, application fee and language
requirements. Its brochure gives only a relative application window, so no absolute
deadline or open status was invented. Official source:
https://xxgk.bupt.edu.cn/__local/4/9D/6D/1EB441EB8B730D5E91D1635D888_A9DEF37C_2D5B4.pdf

## Independent semantic audit corrections

A second agent-team review caught issues that schema validation alone cannot detect.
Before release, the catalog:

- removed four unsupported spring or future cycles;
- stopped mapping registration charges to application fees;
- merged two scholarship/application routes into one Master of Auditing identity;
- removed inferred teaching-language and month-duration claims;
- reclassified cash awards so they are not shown as tuition waivers;
- added scholarship eligibility and duration limitations to public summaries;
- replaced an inaccessible SUSTech URL with the official canonical page;
- added precise official application-system URLs for GDUFS and Shenzhen University;
- kept WKU Spring 2027 separate from its fall-freshman scholarship deadline; and
- kept BUPT's relative October-to-April wording from becoming an invented absolute
  deadline.

## Official candidates withheld from this release

The parallel research team also checked ShanghaiTech University and Ningbo University.
They were not converted into artificial current program volume:

- ShanghaiTech's 2026 International Summer Lab is official, but its April 30, 2026
  deadline is already outside the public window. It remains a historical candidate:
  https://www.shanghaitech.edu.cn/en/2018/0130/c5242a50095/page.htm
- ShanghaiTech publishes a proposed international doctoral tuition figure, but the
  page does not identify a current international program, language requirement,
  deadline or application route. No program was generated from a fee notice.
- Ningbo University's official application and scholarship sections currently expose
  no detailed current records. A third-party repost of a Chinese-language program was
  rejected because the original official notice could not be reproduced.

## Coverage gaps and next gate

The non-military Double First-Class target list contains 144 institutions. The catalog
now matches 117 and still lacks 27. Wenzhou-Kean University improves regional and
international-program breadth but is not counted as Double First-Class.

The next official-source collection wave should first:

1. fill the remaining 27 Double First-Class institutions;
2. raise the 78 universities with at most two programs to at least three verified
   international-applicant programs;
3. prioritize exact tuition, duration and future admission dates;
4. grow the public scholarship set beyond the current 16 without duplicating award
   tiers or converting cash awards into tuition waivers; and
5. rerun the full official directory reconciliation before claiming complete coverage.

## Required pipeline fixes before automated import

1. Require a private raw snapshot and content hash for every claimed fact.
2. Reject homepages for program-level and scholarship-level tasks.
3. Make completed mean strict-validator passed; retain separate fetched, extracted,
   validated and quarantined states.
4. Validate task type before extraction and before persistence.
5. Canonicalize URLs and hashes before scheduling to prevent duplicate work.
6. Run independent extraction and verification, then deterministic date, fee, currency,
   academic-year and ownership checks.
7. Publish only through a versioned release; never write generated values directly into
   the live catalog.
