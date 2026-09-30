# University ranking filters

The university, program and scholarship catalogues share four GET parameters:
`qsRankMax`, `theRankMax`, `usNewsRankMax`, `arwuRankMax`. Each accepts `100`,
`200`, `500`, `1000`, `ranked` or `unverified`; an absent parameter means all.
Selected rankings combine with AND. A program uses its university. A scholarship
must have one linked university that satisfies every selected ranking; links
through a program also count. If a university is selected, that same university
must satisfy the rankings. Program-only scholarship links also supply university
filter options. When an API query selects a program, the selected program's
university must satisfy the rankings. These filters are preserved in pagination URLs,
removable chips and cursor fingerprints.

Rank bands use the upper bound: `201–250` qualifies for Top 500, but not Top 200.
Missing or explicitly overdue evidence is **not yet verified**, rather than
“unranked”. Ranking metadata has its own `checkedAt` and optional `reviewAfter`;
it never changes university, program, fee, deadline or scholarship verification
dates. An overdue newest edition does not silently fall back to an older edition.

`University.rankings` records the system, edition year, minimum/maximum rank,
publisher rank label, source URL and verification dates. U.S. News uses the
**global university** ranking, with the ending year stored in `year` and the
two-year edition shown to users. This is distinct from U.S. domestic rankings.
Evidence links on university and program cards and university details display
edition, rank and checking date. The API includes ranking evidence on institutions
and related program universities; expired ranking evidence is omitted from API
responses. API evidence only includes each system's newest current edition; an
overdue newest edition cannot expose older evidence as its current ranking.
Sources must belong to the ranking publisher or that university's
official domain, including sibling departments inside its registered `.edu.cn`
domain. Unrelated university domains are rejected.

Ranking-only scholarship queries discover award identities through recorded
university or program affiliations even when the scholarship profile is stale.
This is historical affiliation discovery, not confirmation of current award
eligibility. The API still withholds expired funding, deadlines, application
URLs and eligibility scope IDs, marking their field metadata as stale. Explicit
API `institution` and `program` eligibility filters retain their current-fact
requirement, so combining them with rankings can return fewer results than
ranking-only identity discovery.

The sample independently rechecked on 2026-09-30 covers six universities for
QS 2027, THE 2027 and ARWU 2026, and two for U.S. News 2026–2027. Its scope is
explicit: remaining universities have unverified ranking metadata. The six are
Tsinghua, Peking, Fudan, Shanghai Jiao Tong, Zhejiang and the University of Science
and Technology of China; the U.S. News sample is Zhejiang and Shanghai Jiao Tong.
Every record keeps its original catalog verification dates and source IDs.
THE 2027 was published on 2026-09-30. The six THE records now use that published
edition, including tied rank labels; ranking checks do not renew admission facts.

Independent primary-source spot checks:

| University | QS 2027 | THE 2027 | ARWU 2026 | U.S. News 2026–2027 |
| --- | ---: | ---: | ---: | ---: |
| Tsinghua | 14 | 11 | 18 | Not yet verified |
| Peking | 13 | 13 | 22 | Not yet verified |
| Fudan | 26 | 38 | 41 | Not yet verified |
| Shanghai Jiao Tong | 36 | 39 | 27 | 37 |
| Zhejiang | 47 | =34 | 24 | 35 |
| University of Science and Technology of China | =134 | =51 | 39 | Not yet verified |

Evidence: [QS 2027 publisher table](https://www.topuniversities.com/qs-top-uni-wur),
[USTC QS profile](https://www.topuniversities.com/universities/university-science-technology-china),
[THE 2027 publication announcement](https://www.timeshighereducation.com/news/world-university-rankings-2027-results-announced)
and the six publisher profile URLs stored on each university ranking record.
The [ARWU 2026 table](https://www.shanghairanking.com/rankings/arwu/2026) confirms
Tsinghua, Peking, Zhejiang and Shanghai Jiao Tong; the publisher's
[Fudan profile](https://www.shanghairanking.com/universities/Fudan-University) and
[USTC profile](https://www.shanghairanking.com/universities/university-of-science-and-technology-of-china)
confirm the remaining two. U.S. News evidence comes from
[Zhejiang's official facts page](https://www.zju.edu.cn/english/_t2949/facts_figures/list.psp)
and [Shanghai Jiao Tong's official June 17 bulletin](https://gfb.sjtu.edu.cn/cn/show.aspx?flag=2&info_id=3561&info_lb=11).
The running full MiniMax verification retains its frozen input snapshot; these
September 30 ranking updates require a separate incremental university review.

JSON-backed pages and APIs implement these filters. D1 releases currently lack
ranking storage, so the D1 repository and worker explicitly return unsupported
ranking-filter errors instead of silently discarding the parameters. A future
D1 release needs ranking persistence and SQL predicates before enabling them.

Validation: `npm run validate:data`, `npm run typecheck`, the ranking tests,
six-language catalogue-control tests and existing catalogue/API regressions.
