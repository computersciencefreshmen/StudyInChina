# minimax-v2-repair-01-programs — East China Normal University (repair)

- **Batch ID**: `minimax-v2-repair-01-programs`
- **Task kind**: `programs` (v2 repair)
- **Checked At**: `2026-07-27`
- **School in scope**: 1 (ECNU)
- **Output files**:
  - `quality/minimax-expansion/inbox/minimax-v2-repair-01-programs.json`
  - `quality/minimax-expansion/inbox/minimax-v2-repair-01-programs.md` (this file)

## Headline numbers

| Metric | Value |
| --- | --- |
| Schools in scope | 1 |
| Programs collected | 4 |
| Programs publishable | 4 |
| Programs quarantined | 0 |
| Scholarships collected | 0 |
| Specific official URL rate | 1.00 |
| International eligibility evidence rate | 1.00 |
| Individual application evidence rate | 1.00 |
| Duration coverage rate | 1.00 |
| Tuition coverage rate | 1.00 |
| Future deadline coverage rate | 1.00 |
| Search snippet evidence count | 0 |
| Homepage evidence count | 0 |
| Exclusions recorded | 1 |
| Source failures recorded | 1 |

## Programs

| ProgramKey | Degree Level | Duration (months) | Tuition (CNY) | Application Fee (CNY) | Deadline | programUrl |
| --- | --- | --- | --- | --- | --- | --- |
| `…:program:intensive-chinese-language` | language | 6 | 14,000 / semester | 800 | 2026-07-31 | https://lxs.ecnu.edu.cn/en_admission_chinese_language_programs_intensive_chinese_language_program/list.htm |
| `…:program:standard-chinese-language` | language | 6 | 9,800 / semester | 800 | 2026-07-31 | https://lxs.ecnu.edu.cn/en_admission_chinese_language_programs_standard_chinese_language_program/list.htm |
| `…:program:business-chinese-language` | language | 6 | 15,000 / semester | 800 | 2026-07-31 | https://lxs.ecnu.edu.cn/en_admission_chinese_language_programs_business_chinese_language_program/list.htm |
| `…:program:2026-intensive-chinese` | language | 4 | 14,000 / semester | 800 | 2026-07-31 | https://lxs.ecnu.edu.cn/en_admission_chinese_language_programs_intensive_chinese_language_program/list.htm |

All four cycles are bound to `academicYear: "2026-2027"`, `intake: "autumn"`, `publicationEligibility: "open"` (deadline is `2026-07-31`, which is 4 days after `2026-07-27`). `opensOn` is `officially_not_announced` because ECNU's program page does not publish an explicit opening date.

## Reconciliation

| Category | Status |
| --- | --- |
| `international_admissions_home` | collected |
| `bachelor_catalog` | needs_follow_up |
| `master_catalog` | needs_follow_up |
| `doctorate_catalog` | needs_follow_up |
| `non_degree_catalog` | collected |
| `current_admission_guide` | collected |
| `fees` | collected |
| `deadlines` | collected |
| `application_system` | collected |
| `university_scholarships` | needs_follow_up |
| `applicable_government_scholarships` | needs_follow_up |

## Source failures (1)

- `uni-east-china-normal-university` / `scholarships` — three official discovery attempts documented; per-school ECNU scholarship enumeration deferred to a future v2 expand pass.

## Exclusions (1)

- ECNU degree-program catalogs (bachelor / master / doctorate) and per-school scholarship enumeration were not in scope for this repair pass; deferred to future v2 expand tasks.

## Conflicts

None. The four programs do not have two contradictory official values for any field.

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