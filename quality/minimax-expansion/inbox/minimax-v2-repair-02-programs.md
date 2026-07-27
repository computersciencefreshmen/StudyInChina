# minimax-v2-repair-02-programs — Shanghai University of Finance and Economics (repair)

- **Batch ID**: `minimax-v2-repair-02-programs`
- **Task kind**: `programs` (v2 repair)
- **Checked At**: `2026-07-27`
- **School in scope**: 1 (SUFE)
- **Output files**:
  - `quality/minimax-expansion/inbox/minimax-v2-repair-02-programs.json`
  - `quality/minimax-expansion/inbox/minimax-v2-repair-02-programs.md` (this file)

## Headline numbers

| Metric | Value |
| --- | --- |
| Schools in scope | 1 |
| Programs collected | 2 |
| Programs publishable | 2 |
| Programs quarantined | 0 |
| Scholarships collected | 0 |
| Specific official URL rate | 1.00 |
| International eligibility evidence rate | 1.00 |
| Individual application evidence rate | 1.00 |
| Duration coverage rate | 1.00 |
| Tuition coverage rate | 1.00 |
| Future deadline coverage rate | 1.00 (officially_not_announced) |
| Search snippet evidence count | 0 |
| Homepage evidence count | 0 |
| Exclusions recorded | 1 |
| Source failures recorded | 2 |

## Programs

| ProgramKey | Degree Level | Duration (months) | Tuition (CNY) | Application Fee (CNY) | Deadline | programUrl |
| --- | --- | --- | --- | --- | --- | --- |
| `…:program:international-economics-and-trade-bachelor` | bachelor | 48 | 15,000 / academic year | 830 | officially_not_announced | https://intlstu.sufe.edu.cn/2e/f4/c12486a208628/page.htm |
| `…:program:finance-bachelor` | bachelor | 48 | 15,000 / academic year | 830 | officially_not_announced | https://intlstu.sufe.edu.cn/2d/db/c12486a208347/page.htm |

Both cycles are bound to `academicYear: "2026-2027"`, `intake: "autumn"`, `publicationEligibility: "not_announced"`. `opensOn` and `closesOn` are `officially_not_announced` because SUFE's program pages reviewed in this pass do not publish an explicit 2026 autumn deadline.

## Reconciliation

| Category | Status |
| --- | --- |
| `international_admissions_home` | collected |
| `bachelor_catalog` | collected |
| `master_catalog` | needs_follow_up |
| `doctorate_catalog` | needs_follow_up |
| `non_degree_catalog` | needs_follow_up |
| `current_admission_guide` | needs_follow_up |
| `fees` | collected |
| `deadlines` | needs_follow_up |
| `application_system` | collected |
| `university_scholarships` | needs_follow_up |
| `applicable_government_scholarships` | needs_follow_up |

## Source failures (2)

- `uni-shanghai-university-of-finance-and-economics` / `deadlines` — three official discovery attempts documented; current-cycle deadline not yet published.
- `uni-shanghai-university-of-finance-and-economics` / `scholarships` — three official discovery attempts documented; per-school scholarship enumeration deferred.

## Exclusions (1)

- SUFE master / doctorate / non-degree catalogs were not in scope for this repair pass; deferred to future v2 expand tasks.

## Conflicts

None.

## Quality checklist (per `MINIMAX_EXPAND_SCHOOLS_AND_PROGRAMS_PROMPT.md` §十)

| Check | Status |
| --- | --- |
| Every `known` fact URL is HTTPS and on an official domain | PASS |
| Every `known` high-risk field has a `quote` (≤350 chars) and `locator` | PASS |
| International eligibility is `known: true` for all publishable programs | PASS |
| Individual application route is `known: true` for all publishable programs | PASS |
| `programUrl` is a specific official sub-page, not a homepage | PASS |
| No search snippets used as evidence | PASS (count = 0) |
| No homepage evidence (locator + URL combination) | PASS (count = 0) |
| Duration coverage ≥ 60% of publishable | PASS (1.00) |
| Tuition coverage ≥ 50% of publishable | PASS (1.00) |
| Future deadline coverage ≥ 40% of publishable (including officially_not_announced) | PASS (1.00) |
| JSON parses with `JSON.parse` | PASS |

End of summary.