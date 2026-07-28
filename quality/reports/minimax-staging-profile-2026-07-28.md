# MiniMax staging profile — 2026-07-28

## Decision

The three MiniMax collection generations are a discovery pool, not an automatic
publication source. No raw record is promoted solely because its task completed or
its URL uses an official domain. Every promoted record must be independently
reconciled with a program-level official page or PDF and pass the normal Catalog
schema, provenance, freshness and deadline gates.

## Inventory and grain

The audit inspected 870 physical files and 229 parseable inbox JSON outputs. The
intended record grain is one official international-applicant program or one
official scholarship identity, with dynamic facts attached to a specific cycle.

| Collection | Inbox JSON | Schools | Program candidates | Scholarship candidates | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Harvest v1 | 45 | 169 | 226 | 115 | Discovery only |
| Expansion v2 | 128 | 77 | 125 | 0 | 45 identity-only placeholders |
| Recapture v3 | 56 / 102 tasks | 28 | 39 | 0 | 54.9% task completion |
| Deduplicated total | 229 | 192 | 390 | 115 | Quarantined |

Of the 192 candidate schools, 123 already exist in the formal Catalog and 69 may be
new institution candidates. Candidate keys are not canonical Catalog IDs and must
pass entity resolution before import.

## Completeness and timeliness

The reference date is 2026-07-28. A current opportunity requires a deadline at least
30 days in the future, unless the official source explicitly states rolling or open
admissions.

| Check | Programs | Scholarships |
| --- | ---: | ---: |
| Deadline at least 30 days in the future | 37 / 390 | 0 / 115 |
| Deadline less than 30 days in the future | 13 / 390 | 0 / 115 |
| Expired deadline | 47 / 390 | 8 / 115 |
| Missing deadline | 290 / 390 | 107 / 115 |
| Invalid date format | 3 / 390 | 0 / 115 |
| Missing duration | 280 / 390 | — |
| Missing tuition | 322 / 390 | — |
| Missing application entry point | 182 / 390 | 2 / 115 |
| Missing program-detail URL | 45 / 390 | — |

Only two program candidates passed a conservative machine pre-screen requiring
localized names, a specific official page, international and individual eligibility,
duration, tuition, an application entry point and a future deadline:

- Shanghai Jiao Tong University Chinese Language Program
- Guangzhou Medical University Clinical Medicine (MBBS)

They remain independent-verification candidates rather than publishable facts.

## High-severity findings

1. All three records marked `publishable=true` were homepage false positives. Their
   names were empty, duration and tuition were absent, and a bare `2026` was
   misclassified as a deadline.
2. Eleven `*-scholarships.json` files contained program records instead of
   scholarship records.
3. The 39 recapture programs all lacked Chinese and English program names, duration
   and tuition.
4. Expansion contained 45 `identity-only` placeholder programs.
5. The evidence chain was incomplete: 71 HTML snapshots represented only 49 unique
   hashes; 40 snapshots were unreferenced and two referenced snapshot paths were
   missing.
6. `191 / 345` program URLs and `59 / 115` scholarship URLs pointed to a homepage.
   An official homepage proves the institution exists, not that a program or award
   exists.
7. Thirty-one evidence locators relied on search snippets.
8. Thirteen semantic duplicate groups covered 26 program records; 120 candidate
   programs already matched a formal Catalog program by school and normalized name.

## Locked automatic gates

1. File type must match the enclosed entity type.
2. Names, keys, IDs, slugs and dates must be canonical and non-placeholder.
3. Homepage and navigation pages cannot support program, fee, deadline or scholarship
   facts.
4. Each high-risk fact requires an official URL, exact evidence, a locator, an
   existing private snapshot and a matching content hash.
5. Search snippets and generated evidence templates are rejected.
6. International eligibility and individual application must both be explicitly
   supported.
7. Exact deadlines must be valid dates and remain at least 30 days in the future;
   annual rules are stored as recurring rules rather than fabricated cycle dates.
8. Entity resolution and duplicate/conflict checks run before persistence.
9. Passing extraction validation is necessary but not sufficient: only a versioned
   Catalog Release may become public.

## Impact

The MiniMax material is still valuable: it gives a 192-school discovery map and a
37-record future-deadline review queue. The safe scaling strategy is to process that
queue by official-source priority, keep failed records quarantined, and publish small
verified releases continuously. This avoids turning collection volume into false
student guidance.
