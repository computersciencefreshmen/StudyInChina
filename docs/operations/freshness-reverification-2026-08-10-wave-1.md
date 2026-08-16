# Freshness reverification — 2026-08-10, wave 1

## Purpose

This is a deliberately small, high-confidence review of applicant-facing deadlines, fees, requirements and scholarship coverage. Every accepted value was checked against a live official HTTPS source on 2026-08-10. Search results and aggregators were not used as evidence, and a historical value was not copied into a current cycle.

The review cadence follows `docs/content-maintenance.md`: three days when a live deadline is within 45 days, seven days for other current admission and scholarship sources, and 30 days for stable program requirements.

## Accepted facts

| Record group | Official evidence | Accepted fields | Next review |
|---|---|---|---|
| Schwarzman Scholars, class of 2027–2028 | `https://www.schwarzmanscholars.org/admissions/application-instructions/`; `https://www.schwarzmanscholars.org/program-experience/`; Tsinghua's English-program list | Global route open 2026-04-08 through 2026-09-09; one-year full scholarship; exact English thresholds; one-minute video is recommended, not required | 2026-08-13 |
| Soochow long-term Chinese | `https://oversea.suda.edu.cn/11295/list.htm` | 2026-09-30 deadline; CNY 8,500 per semester or CNY 17,000 per academic year; CNY 500 application fee | 2026-08-17 |
| Soochow ICLT Scholarship | `https://oversea.suda.edu.cn/oversea_en/bb/fd/c11345a441341/page.htm`; CLEC 2026 official guideline PDF | March 2027 one-semester route closes 2026-10-31; five-month duration; HSK 3 score 180 plus HSKK; tuition, accommodation, living allowance and medical-insurance coverage | 2026-08-17 |
| SCAU Guangdong Government Scholarship | `https://gdic.scau.edu.cn/2026/0421/c11155a432798/page.htm` | 2026-09-01 deadline; one-time awards of CNY 10,000 / 20,000 / 30,000 for bachelor's / master's / doctoral students | 2026-08-13 |
| ZUST ICLT Scholarship | `https://ies.zust.edu.cn/info/1271/4219.htm`; CLEC 2026 official guideline PDF | March 2027 semester deadline 2026-10-31; master HSK 5 score 210 and HSKK 60; semester HSK 3 score 180 plus HSKK; tuition, accommodation, living allowance and medical-insurance coverage | 2026-08-17 for cycles/scholarship; 2026-09-09 for program requirements |

The CLEC guideline is the already registered source `src-gov-clec` at `https://pmplatform.chinese.cn/tmp/2026/2/6/94005b2e-f2e9-438e-85e7-12212f0e9968.pdf`. Its allowance amounts vary by scholarship category, so the single `stipendCnyPerMonth` field remains `null` instead of collapsing multiple tiers into one misleading value.

## Rejected / unresolved fact

NUIST's current official page says the one-semester route can start in March 2027, but its deadline list labels October 29 as applying to “March 2026”. The CLEC 2026 guideline instead states March 2027 with a general October 31 deadline. The existing NUIST October 29 value was not extended or rewritten in this wave. Its `reviewAfter` remains 2026-08-10 and it requires a second institution-specific official source or a corrected NUIST notice before another verified horizon is assigned.

This is a high-risk date association issue, not evidence that the scholarship or program identity is invalid.
