# minimax-v2-repair-03-programs — Nanjing Medical University (repair)

- **Batch ID**: `minimax-v2-repair-03-programs`
- **Task kind**: `programs` (v2 repair)
- **Checked At**: `2026-07-27`
- **School in scope**: 1 (NJMU)
- **Output files**:
  - `quality/minimax-expansion/inbox/minimax-v2-repair-03-programs.json`
  - `quality/minimax-expansion/inbox/minimax-v2-repair-03-programs.md` (this file)

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
| Source failures recorded | 3 |

## Programs

| ProgramKey | Degree Level | Duration (months) | Tuition (CNY) | Application Fee (CNY) | Deadline | programUrl |
| --- | --- | --- | --- | --- | --- | --- |
| `…:program:clinical-medicine-mbbs-bachelor` | bachelor | 60 | 30,000 / academic year | source_unavailable | officially_not_announced | https://xxgk.njmu.edu.cn/2026/0115/c20186a296924/page.htm |
| `…:program:public-health-and-preventive-medicine-master` | master | 72 | 34,000 / academic year | source_unavailable | officially_not_announced | https://xxgk.njmu.edu.cn/2026/0115/c20169a296923/page.htm |

Both cycles are bound to `academicYear: "2026-2027"`, `intake: "autumn"`, `publicationEligibility: "not_announced"`. Application fee is `source_unavailable` for both programs because the reviewed English-language pages do not enumerate it.

## Reconciliation

| Category | Status |
| --- | --- |
| `international_admissions_home` | collected |
| `bachelor_catalog` | collected |
| `master_catalog` | collected |
| `doctorate_catalog` | needs_follow_up |
| `non_degree_catalog` | needs_follow_up |
| `current_admission_guide` | needs_follow_up |
| `fees` | collected |
| `deadlines` | needs_follow_up |
| `application_system` | collected |
| `university_scholarships` | needs_follow_up |
| `applicable_government_scholarships` | needs_follow_up |

## Source failures (3)

- `uni-nanjing-medical-university` / `deadlines` — three official discovery attempts documented.
- `uni-nanjing-medical-university` / `fees` (application fee) — three official discovery attempts documented.
- `uni-nanjing-medical-university` / `scholarships` — three official discovery attempts documented.

## Exclusions (1)

- NJMU doctorate and non-degree program catalogs were not in scope for this repair pass.

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
| JSON parses with `JSON.parse` | PASS |

End of summary.