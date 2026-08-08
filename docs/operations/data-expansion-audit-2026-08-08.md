# Official catalog expansion audit — 2026-08-08

## Dataset and grain

This audit covers three candidate packs collected on 2026-08-05:

- `east-coast-medical-art.json`
- `north-northeast-west.json`
- `south-central-west.json`

The candidate grain is one program identity or one scholarship identity at one institution. Dynamic facts remain separate admission-cycle facts. The formal catalog remains the only public dataset; candidate packs are evidence-bearing inputs, not public records.

## Checks performed

| Check | Result |
| --- | ---: |
| Candidate programs | 61 |
| Candidate scholarships | 23 |
| New universities | 9 |
| New cities | 2 |
| Distinct represented institutions | 23 |
| Quality tier A | 60 |
| Quality tier B | 24 |
| Official HTTPS evidence | 84 / 84 |
| Placeholder translations | 0 |
| Exact semantic duplicates against the existing catalog | 0 |
| Individually applicable programs materialized from this wave | 60 / 61 |
| Candidate open routes after 2026-08-08 | 2 |
| Individually applicable open routes after policy filtering | 0 |

Every primary evidence URL is on an official university HTTPS domain. The only external application host is the university-configured `njfu.17gz.org` application system already permitted by the catalog policy.

## Publication impact

| Public metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Universities | 257 | 266 | +9 |
| Programs | 1,152 | 1,211 | +59 |
| Scholarships | 332 | 355 | +23 |
| Universities with 3+ programs | 226 | 249 | +23 |
| Universities with 1 program | 2 | 1 | -1 |
| Universities with 2 programs | 29 | 16 | -13 |
| Universities linked to a scholarship | 192 | 205 | +13 |

New public universities are Guangdong Ocean University, Guangdong Pharmaceutical University, Guangzhou Academy of Fine Arts, Guilin University of Technology, Hebei Normal University, Ningxia Medical University, Northeast Electric Power University, Shandong University of Traditional Chinese Medicine, and Sichuan Fine Arts Institute.

Guangxi Minzu University increased from one to three programs. Liaoning Normal University increased from two to five. The expansion also deepened 12 other previously sparse institutions.

## Findings and mitigations

### Group-only routes were removed from the individual-application catalog

**Severity:** High
**Confidence:** High

The Hebei Normal University four-week Chinese-language route has a future 2026-09-15 deadline, but the official guide requires an authorized recommending institution to submit a group of 10–15 participants. It is not an individually applicable program and is therefore quarantined despite its future date. The linked International Chinese Language Teachers Scholarship identity remains visible for its degree routes, but its group-only four-week deadline and program link are withheld.

The same policy guard also removed a previously materialized Guangdong University of Foreign Studies four-week group route. The integration layer now quarantines every program carrying `group_application_only`, drops scholarship references to the quarantined identity, and suppresses an open scholarship cycle carrying `group_application_only_for_open_route`. The canonical importer fails closed if a group-only candidate reaches the formal merged ledger.

### Historical dynamic facts were unsafe to publish as current

**Severity:** High
**Confidence:** High

Three Guangdong Ocean University program identities and two scholarship identities use a 2021 official handbook for historical details. Their candidate summaries explicitly limit the evidence to identity confirmation, but the generic importer previously mapped their historical duration, tuition, teaching-language, and funding values into current catalog fields.

The importer now checks the candidate risk flags before materialization:

- `program_facts_from_2021_handbook` and `current_course_cycle_and_fee_not_reconfirmed` force identity-only program publication;
- `funding_details_from_2021_handbook` and `current_cycle_and_terms_not_reconfirmed` force scholarship coverage to `unknown`;
- official URLs and evidence summaries remain visible so applicants can verify the source themselves.

Regression tests verify that these five identities cannot leak historical dynamic values into programs, admission cycles, or scholarship coverage.

### Tibet University remains a documented limited catalog

**Severity:** Low
**Confidence:** High

Five independent official-source discovery waves found only the already published Tibetan Language non-degree route. A MiniMax candidate for a Tibetan Studies master's degree used the university homepage and marked international eligibility and individual application as unannounced; it is not publishable evidence. No placeholder was added.

Tibet University therefore remains at one verified program until a current official international-student catalog exposes another individually applicable route. This is a deliberate reconciliation result, not an ingestion failure.

## Automated gates

The expansion passes:

- canonical bundle schema validation;
- strict publication coverage (266 / 266 public universities have at least one program);
- zero semantic program duplicates;
- official-source, translation, deadline, cross-institution reference, and exact materialization tests;
- historical-fact withholding regression tests.

## Remaining work

Sixteen universities still have two public programs. The next evidence collection wave should prioritize Guangxi University, Guangzhou Medical University, Guizhou Medical University, Hunan University of Technology and Business, Jiangxi Normal University, Kunming University of Science and Technology, Wuhan Textile University, Wuhan University of Science and Technology, Zhengzhou University, China University of Geosciences (Wuhan), Ocean University of China, China Conservatory of Music, Zhongnan University of Economics and Law, and Central South University. Southern University of Science and Technology and Zhejiang University already have additional draft identities that require evidence repair rather than new placeholders.
