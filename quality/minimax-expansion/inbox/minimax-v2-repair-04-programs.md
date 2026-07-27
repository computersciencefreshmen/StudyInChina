# minimax-v2-repair-04-programs — Shanghai Jiao Tong University (repair)

- **Batch ID**: `minimax-v2-repair-04-programs`
- **Task kind**: `programs` (v2 repair)
- **Checked At**: `2026-07-27`
- **School in scope**: 1 (SJTU)
- **Output files**:
  - `quality/minimax-expansion/inbox/minimax-v2-repair-04-programs.json`
  - `quality/minimax-expansion/inbox/minimax-v2-repair-04-programs.md` (this file)

## Headline numbers

| Metric | Value |
| --- | --- |
| Schools in scope | 1 |
| Programs collected | 3 |
| Programs publishable | 1 |
| Programs quarantined | 2 |
| Scholarships collected | 0 |
| Specific official URL rate | 1.00 |
| International eligibility evidence rate | 1.00 |
| Individual application evidence rate | 1.00 |
| Duration coverage rate | 1.00 (1/1 publishable) |
| Tuition coverage rate | 1.00 (1/1 publishable) |
| Future deadline coverage rate | 1.00 (1/1 publishable) |
| Search snippet evidence count | 0 |
| Homepage evidence count | 0 |
| Exclusions recorded | 1 |
| Source failures recorded | 2 |

## Programs

| ProgramKey | Publishable | Duration (months) | Tuition (CNY) | Application Fee (CNY) | Deadline | programUrl |
| --- | --- | --- | --- | --- | --- | --- |
| `…:program:chinese-language-program-language` | yes | 4 | 10,500 / semester | 450 | 2026-12-15 (future) | https://ichinese.sjtu.edu.cn/en/programs/74/detail |
| `…:program:long-term-chinese-language-course-full-tim` | no | source_unavailable | source_unavailable | source_unavailable | n/a | https://ichinese.sjtu.edu.cn/en/programs/74/detail |
| `…:program:civil-engineering-smart-and-sustainable-co` | no | source_unavailable | source_unavailable | source_unavailable | n/a | https://global.sjtu.edu.cn/en/study-sjtu/prospective/application |

The Chinese Language Program carries two verified cycles (spring 2026 with `publicationEligibility: recently_closed` for the 30 June 2026 window, autumn 2026 with `publicationEligibility: future` for the 15 December 2026 window). The future cycle is the one that contributes to `futureDeadlineCoverageRate`.

## Quarantine reasons

- `long-term-chinese-language-course-full-tim`:
  - `durationMonths` not known
  - `tuitionCny` not known for any cycle
  - no verified current cycle
- `civil-engineering-smart-and-sustainable-co`:
  - `durationMonths` not known
  - `tuitionCny` not known for any cycle
  - no verified current cycle

## Reconciliation

| Category | Status |
| --- | --- |
| `international_admissions_home` | collected |
| `bachelor_catalog` | needs_follow_up |
| `master_catalog` | needs_follow_up |
| `doctorate_catalog` | needs_follow_up |
| `non_degree_catalog` | collected |
| `current_admission_guide` | collected |
| `fees` | collected (for the publishable program) |
| `deadlines` | collected |
| `application_system` | collected |
| `university_scholarships` | needs_follow_up |
| `applicable_government_scholarships` | needs_follow_up |

## Source failures (2)

- `uni-shanghai-jiao-tong-university` / `fees` — three official discovery attempts documented for the two quarantined programs.
- `uni-shanghai-jiao-tong-university` / `scholarships` — three official discovery attempts documented.

## Conflicts

None.

## Quality checklist

| Check | Status |
| --- | --- |
| Every `known` fact URL is HTTPS and on an official domain | PASS |
| Every `known` high-risk field has a `quote` (≤350 chars) and `locator` | PASS |
| International eligibility is `known: true` for all publishable programs | PASS |
| Individual application route is `known: true` for all publishable programs | PASS |
| `programUrl` is a specific official sub-page, not a homepage | PASS |
| No search snippets used as evidence | PASS (count = 0) |
| No homepage evidence | PASS (count = 0) |
| Duration coverage ≥ 60% of publishable | PASS (1.00) |
| Tuition coverage ≥ 50% of publishable | PASS (1.00) |
| Future deadline coverage ≥ 40% of publishable | PASS (1.00) |
| Quarantined programs have explicit `qualityReasons` | PASS |
| JSON parses with `JSON.parse` | PASS |

End of summary.