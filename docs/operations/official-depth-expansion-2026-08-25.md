# Official depth expansion audit — 2026-08-25

## Decision

This wave is approved as an official-source depth expansion. It adds 11 program identities and four scholarship identities without creating any current-open application claim. Closed 2026 rounds remain historical facts, and missing 2027 dates remain unannounced rather than inferred.

## Goal and architecture position

The catalogue had eight universities with fewer than three published programs. This wave deepens five of them using current university admissions pages, while preserving Tibet University as a documented limited catalogue.

Within the production architecture, this audit sits between official-source discovery and entity publication:

`official university source → evidence review → program/scholarship materialization → versioned catalogue Release`

Program identity is kept separate from admission-cycle state. An official page can therefore establish that an international-student route exists without making an expired deadline look actionable.

## Official source ledger

All sources below were checked on 2026-08-25. No ranking site or admissions aggregator was used as factual evidence.

| Institution | Official source and page title | Evidence used |
| --- | --- | --- |
| China University of Geosciences (Wuhan) | [CUG 2026 Chinese Government Scholarship — High-Level Postgraduate Program](https://eniec.cug.edu.cn/Scholarships/Chinese_Government_Scholarships/High_Level_Postgraduate_Program.htm) | English-taught postgraduate catalogue and historical 2026 scholarship route |
| China University of Geosciences (Wuhan) | [CUG 2026 International Chinese Language Teachers Scholarship](https://eniec.cug.edu.cn/Scholarships/Chinese_Government_Scholarships/International_Chinese_Language_Teachers_Scholars.htm) | Scholarship identity and confirmed coverage only |
| Guangzhou Medical University | [Guangzhou Medical University 2026 Admission Guide for International Master's/Doctoral Students](https://fao.gzhmu.edu.cn/info/1301/9522.htm) | Academic doctoral route, language, duration and tuition |
| Guizhou Medical University | [Guizhou Medical University 2026 Chinese Government Scholarship ASEAN Countries Program](https://soe.gmc.edu.cn/info/1008/1656.htm) | Three eligible undergraduate majors and their durations |
| Jiangxi Normal University | [Jiangxi Normal University 2026 English-Taught Undergraduate Programs Admission Guide](https://laihua.jxnu.edu.cn/2026/0226/c5944a289932/page.htm) | Three English-taught bachelor programs and university scholarship identity |
| Wuhan Textile University | [Wuhan Textile University 2026 Admission Guidance for International Students](https://iec.wtu.edu.cn/info/1060/4292.htm) | Three English-taught master programs and two scholarship identities |
| Tibet University | [西藏大学非学历留学生招生简章（Xizang University Application Guideline for Non-Degree International Students）](https://gjc.utibet.edu.cn/info/1061/1441.htm) | Reconciliation of the single Tibetan-language non-degree route |

## Program identities added

| Institution | Added identities | Verified static facts |
| --- | --- | --- |
| China University of Geosciences (Wuhan) | Business Administration — High-Level Postgraduate Scholarship Route | Master; English taught; duration not announced |
| Guangzhou Medical University | Academic Doctorate in Medicine and Medical-related Fields | Doctorate; Chinese taught; 36 months; CNY 30,000 per year |
| Guizhou Medical University | Nursing; Preventive Medicine; Medical Laboratory Technology — China-ASEAN Scholarship Route | Bachelor; Chinese taught; 48, 60 and 48 months respectively |
| Jiangxi Normal University | Business Administration; International Economics and Trade; Computer Science and Technology | Bachelor; English taught; 48 months |
| Wuhan Textile University | Textile Engineering; Computer Science and Technology; Business Administration | Master; English taught; 24 months; tuition not announced in the reviewed guide |

The distribution is `1 + 1 + 3 + 3 + 3 = 11`. Specific Guangzhou Medical University specialties were not invented from a protected attachment; the published identity remains at the exact grouped level stated by the official guide.

## Scholarship identities added

| Institution | Scholarship | Published scope |
| --- | --- | --- |
| China University of Geosciences (Wuhan) | CUG International Chinese Language Teachers Scholarship | Tuition, accommodation and insurance confirmed; stipend amount and safe current deadline not published |
| Jiangxi Normal University | JXNU International Student Scholarship | Identity confirmed by the 2026 guide; current award amount and coverage remain unknown |
| Wuhan Textile University | Hubei Provincial Scholarship at WTU | Identity confirmed; current coverage values remain unknown |
| Wuhan Textile University | WTU International Student Scholarship | Identity confirmed; current coverage values remain unknown |

The CUG language-teacher scholarship page has an intake-year conflict: it associates an October 31 deadline with a March 2026 intake without establishing a safe application year. The scholarship identity and coverage are publishable, but no deadline or open state is materialized from that page.

## Admission-cycle safety

Historical and ambiguous dates do not count toward current application availability:

- CUG High-Level Postgraduate Program: 2026-02-28 deadline, closed.
- Guangzhou Medical University graduate guide: 2026-06-30 deadline, closed.
- Guizhou Medical University ASEAN route: 2026-04-16 deadline, closed.
- Jiangxi Normal University undergraduate guide: May 2026 deadline with no safe day value, closed.
- Wuhan Textile University: September 30 is described as a registration deadline, not an application deadline; no application state is inferred.
- Tibet University: annual March 1–May 31 application period; the 2026 round is closed.
- CUG International Chinese Language Teachers Scholarship: conflicting year semantics; no deadline is published to the catalogue.

Accordingly, the wave adds zero `open` or `upcoming` cycles. Historical cycles remain available for provenance but are excluded from current-open metrics and filters.

## Tibet University reconciliation

The reviewed official guide confirms one individually applicable Tibetan-language non-degree program. It does not establish additional degree programs or a school-linked international scholarship. Tibet University therefore remains `limited_official_catalog` at one verified program. Course modules inside that route are not split into artificial program identities.

## Published impact

| Public metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Programs | 1,234 | 1,245 | +11 |
| Scholarships | 360 | 364 | +4 |
| Universities below three programs | 8 | 3 | −5 |
| Overdue records still marked `verified` | 28 | 0 | −28 |

CUG, Guangzhou Medical University, Guizhou Medical University, Jiangxi Normal University and Wuhan Textile University cross the three-program threshold. The overdue reduction is a freshness-state correction: records past their review date are no longer represented as verified, and it must not be described as new admissions coverage.

## Release constraints

- No expired 2026 date may produce an open CTA or increase current-open coverage.
- No 2027 deadline, tuition or scholarship amount is inferred before an official announcement.
- Scholarship-funded tuition waivers are not copied into a program's self-funded tuition field.
- A registration deadline is not treated as an application deadline.
- Tibet University remains limited until another official international-student route is evidenced.
