# Current future-program expansion — 2026-07-28

## Result

- Stored Catalog: 131 universities, 327 programs, 123 admission cycles,
  48 scholarships, 353 official/curated sources and 37 cities.
- Publication view on 2026-07-28: 130 universities, 295 programs,
  93 admission cycles and 25 scholarships.
- This batch adds or materially completes 12 individually applicable programs
  at 10 universities and 9 school-specific scholarship routes.
- Public names and cycle notes are present in English, Chinese and Russian.

## Verified future programs

| University | Program | Deadline evidence | Key verified facts |
| --- | --- | --- | --- |
| Xiamen University | Long-Term Chinese Language, Spring 2027 | 2026-12-30, cycle-specific | Feb–Jun 2027; CNY 13,000/semester; CNY 400 fee |
| Donghua University | 2027 Winter Chinese | 2026-11-30, cycle-specific | Jan 6–26; CNY 3,600; CNY 600 fee |
| Donghua University | ICLT One-Semester Study | 2026-10-31, cycle-specific | Five months; funded tuition/accommodation/stipend/insurance |
| Shanghai University | ICLT One-Semester Study | 2026-10-31, cycle-specific | Six directions retained under one program |
| Xinjiang University | ICLT One-Semester Study | 2026-10-31, cycle-specific | Four directions retained under one program; dual application |
| Shaanxi Normal University | ICLT One-Semester Study | 2026-10-31, cycle-specific | Four directions retained under one program; dual application |
| Beijing Language University | ICLT One-Semester Study | 2026-10-31, cycle-specific | Two directions retained under one program |
| Beijing Foreign Studies University | General Chinese Training | Dec 15 each year, recurring official rule | About 18 weeks; CNY 12,000/semester; CNY 800 fee |
| Beijing Foreign Studies University | ICLT One-Semester Study | 2026-12-30, cycle-specific | Start-month conflict is disclosed; deadline and spring intake retained |
| UIBE | International Foundation, Spring 2027 | Oct 1–Dec 31 each year, recurring official rule | About 16 weeks; CNY 15,600/semester; CNY 660 fee |
| Tianjin University | ICLT One-Semester Study | 2026-10-31, cycle-specific | Existing program/cycle IDs preserved; three directions; dual application |
| Nankai University | ICLT One-Semester Study | 2026-10-31, cycle-specific | Five directions; CNY 400 non-degree application fee |

## Rejected inflation

- Study directions are stored in cycle notes and are not counted as independent
  programs.
- Four-week routes that require a recommending institution to organise a group
  are excluded from the individual-application catalog.
- Closed 2026 degree cycles are not relabelled as 2027.
- Scholarship coverage is not written as a zero list-price tuition.
- Registration fees are not mapped to application fees unless the official
  procedure explicitly treats the payment as the application/enrolment fee.
- Teaching language remains empty when the official source does not state it;
  an HSK threshold alone is not used to infer instruction language.

## Maintenance changes

- The weekly fact refresh now derives its queue from the current Catalog instead
  of a fixed 250-record review file.
- Current capacity is 301 verified/stale programs across 189 unique official
  URLs, below the guarded weekly limit of 1,000.
- Requests to the same official domain start at least five seconds apart.
- A successful official page check renews program identity freshness only when
  the page still contains the program name; dynamic dates and fees still require
  deterministic evidence extraction.
- R2 uploads are checked against the validated run manifest instead of a fixed
  64-object assumption.
- CI runs `validate:maintenance`; daily health checks, daily D1 backups and
  quarterly restore drills remain required.
