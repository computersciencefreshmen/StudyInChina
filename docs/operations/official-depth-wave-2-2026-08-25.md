# Official depth wave 2 — SISU, AHU and CQU — 2026-08-25

## Decision

This wave is approved as an official-source depth update for ten existing program identities and six scholarship identities. It does not create a new program identity and does not turn any closed 2026 degree round into a current opportunity.

The publication contract is:

`official source → exact evidence locator → static program fact or cycle-scoped fact → publication safety check`

Program identity, historical cycle and current application state remain separate. A tuition amount from a closed round can improve the historical decision record without increasing current tuition coverage.

## Materialized program facts

| Institution | Existing identity | Safe facts materialized | Cycle treatment |
| --- | --- | --- | --- |
| SISU | International Relations, master | 24 months; English; IELTS 6.0/equivalent; official portal | 2026 tuition CNY 26,000/year, fee CNY 800 and 30 April deadline retained only as a closed historical cycle |
| SISU | Translation, bachelor | 48 months; Chinese; HSK 5 plus language/CSCA assessments; official portal | 2026 tuition CNY 24,800/year, fee CNY 750 and 15 April deadline retained only as a closed historical cycle |
| SISU | Teaching Chinese to Speakers of Other Languages, bachelor | 48 months; Chinese | No cycle, fee, HSK threshold or CTA is materialized because Hongkou and Songjiang facts conflict |
| SISU | International Chinese Language Education, master | 24 months; Chinese; HSK 5 (180) or two years of Chinese study; professional English; official portal | 2026 tuition CNY 26,000/year, fee CNY 800 and 30 April deadline retained only as a closed historical cycle |
| SISU | ICLT one-semester study, spring 2027 | 5 months; Chinese; direction-specific HSK/HSKK rules | Deadline 31 October 2026 is published; opening date and application fee remain unknown |
| AHU | International Economics and Trade, bachelor | 48 months; Chinese; official catalogue identity | No cycle and no main application CTA |
| AHU | Computer Science and Technology, bachelor | 48 months; Chinese; official catalogue identity | No cycle and no main application CTA |
| CQU | Civil Engineering, bachelor | 48 months; English; IELTS 6/TOEFL 80 or official alternative; official portal | 2026 tuition CNY 25,000/year, fee CNY 600 and 31 May deadline retained only as a closed historical cycle |
| CQU | Electrical Engineering and Automation, bachelor | 48 months; English; IELTS 6/TOEFL 80 or official alternative; official portal | Same closed 2026 treatment; tuition CNY 25,000/year |
| CQU | Materials Engineering, bachelor | 48 months; English; IELTS 6/TOEFL 80 or official alternative; official portal | Same closed 2026 treatment; tuition CNY 28,000/year |

All ten identities retain their existing IDs and slugs. Their English, Chinese, Russian, German, French and Spanish names are complete.

## Conflict and non-publication ledger

### SISU TCSOL campus conflict

The SISU bachelor source exposes two materially different routes:

- Hongkou: CNY 500 application fee, 20 July deadline and HSK 4 (180).
- Songjiang: CNY 750 application fee, 15 April deadline and HSK 5.

The existing catalogue identity does not encode campus. Combining these values would create a synthetic route that does not exist. Only the common facts — 48 months and Chinese teaching — are materialized. The route keeps a null CTA, empty language requirement and no admission cycle until campus-specific identities can be reconciled.

### AHU undated reference

The official AHU reference PDF does not identify an admission year or academic year. It contains candidate values of CNY 15,000/year, CNY 400 application fee and HSK 4 (200), but the admission-cycle schema correctly requires an academic year. These three values are therefore evidence candidates only and are not written to a program or cycle.

The AHU online application portal at `https://admission.sie.ahu.edu.cn/` failed TLS verification during the check. It is not used as a verified main CTA. The two program identities retain `applyUrl: null`.

### CQU President Scholarship insurance conflict

The 2026 President Scholarship page and the separate official coverage notice disagree on insurance. The scholarship identity stores `insurance: unknown` and cites both sources. No attachment-derived program scope is published until that scope is reconciled.

### CQU ICLT application state

The official guide distinguishes two rounds:

- September 2026 entry closed on 11 May 2026.
- March 2027 entry has a 31 October 2026 deadline, but no opening date is announced.

The scholarship stores the official future deadline but keeps `applicationUrl: null`. This lets the catalogue display the date without presenting an “open application” CTA.

## Scholarship treatment

| Scholarship | Stored result | Publication at 2026-08-25 |
| --- | --- | --- |
| SISU ICLT, spring 2027 | Full tuition, accommodation subsidy/reduction, insurance, CNY 2,500/month; 31 October deadline; dual-system warning | Current verified identity and deadline |
| SISU Shanghai Government Scholarship 2026 | Type A/B coverage and exact exclusions; 31 March deadline | Raw historical record only; expired route is not published as current |
| AHU CSC High-Level Postgraduate 2026–2027 | Master/doctor requirements and 15 March deadline; coverage unknown; no program scope | Raw historical record only |
| CQU President Scholarship 2026 | Three award tiers; insurance unknown; 17 May deadline; no program scope | Raw historical record only |
| Chongqing Mayor Scholarship at CQU 2026 | CQU-only master/doctor route; tuition waiver and CNY 30,000/35,000 yearly award; 16 June deadline | Raw historical record only |
| CQU ICLT 2026 guide | Tuition, accommodation and insurance; stipend amounts retained in summary; March 2027 deadline with unknown opening | Current verified identity; no application CTA |

The existing global `scholarship-chongqing-mayor` record is narrowed to CQU. CQU-specific 2026 facts are not propagated to Southwest University.

## Official evidence locators

All sources were accessed on 2026-08-25 and use HTTPS.

| Claim group | Official source | Evidence locator |
| --- | --- | --- |
| SISU master duration, tuition, fee, deadline and requirements | [SISU international master’s catalogue](https://www.oisa.shisu.edu.cn/index.php/index/lxxm/cid/90.html) | International Relations and International Chinese Language Education rows; application period, tuition/application-fee and language-requirement columns |
| SISU bachelor duration, tuition, fee, deadline and requirements | [SISU international bachelor’s catalogue](https://www.oisa.shisu.edu.cn/index.php/Index/lxxm/cid/87) | Translation row and campus-specific TCSOL rows; duration, tuition/application-fee, deadline and language/admission-test columns |
| SISU ICLT spring 2027 | [SISU 2026 ICLT guide](https://www.oisa.shisu.edu.cn/index.php/index/newscontent/cid/39/id/666.html) | One-semester study category; application procedures, funding and deadline sections |
| SISU Shanghai Government Scholarship | [SISU 2026 Shanghai Government Scholarship guide](https://www.oisa.shisu.edu.cn/index.php/index/newscontent/cid/39/id/660.html) | Scholarship Types A/B, eligibility/exclusions and application period sections |
| SISU applications | [SISU application portal](https://apply.shisu.edu.cn/c.asp?action=student_sign) | Student sign-in entry |
| AHU program identities | [AHU undergraduate catalogue](https://en.ahu.edu.cn/_upload/article/files/4a/16/4b61336d455ebb09fc8c0d6fe48f/6ebe828e-06b9-4dc6-9181-cf0ab343cb7a.pdf) | International Economics and Trade and Computer Science and Technology rows |
| AHU duration and withheld reference candidates | [AHU undated admission reference](https://sie.ahu.edu.cn/_upload/article/files/b4/e0/c137afce42859129fc0e68b094df/2fa37fb8-dd10-451b-a7c9-d1759a9bc289.pdf) | Undergraduate duration and fees/language-requirement sections; no year marker present |
| AHU CSC route | [AHU 2026–2027 CSC guide](https://sie.ahu.edu.cn/_upload/article/files/cf/ee/3543c52a4212b79315534aeeb995/98db637b-5d63-40a2-9d4b-1db3300f3701.pdf) | Application period, applicant categories and language requirements sections |
| CQU undergraduate dates and requirements | [CQU 2026 undergraduate guide](https://study.cqu.edu.cn/lxsq/zsxx/xlxm/zqbkszsjz.htm) | English-taught program table; application deadline, fee and language requirement sections |
| CQU tuition | [CQU tuition and accommodation fees](https://study.cqu.edu.cn/HOME/ADMISSION/Overview/Tuition_and_Accommodation_Fees.htm) | English-taught bachelor tuition table |
| CQU applications | [CQU application portal](https://cqu.17gz.org/member/login.do) | International applicant login entry |
| CQU President Scholarship | [2026 President Scholarship](https://study.cqu.edu.cn/info/1390/2859.htm) and [coverage notice](https://study.cqu.edu.cn/info/1744/1324.htm) | Award standards, application deadline and conflicting insurance descriptions |
| Chongqing Mayor Scholarship at CQU | [2026 Mayor Scholarship](https://study.cqu.edu.cn/info/1389/2913.htm) | Applicant category, award standard, cost responsibility and deadline sections |
| CQU ICLT | [CQU 2026 ICLT guide](https://study.cqu.edu.cn/info/1388/2836.htm) | Program categories, funding standards, September 2026 and March 2027 deadlines, MTCOSL funding duration |

## Release constraints

- The six closed degree cycles must stay `stale` and `previous-cycle-reference` and must not enter public current-cycle filters.
- No AHU admission cycle may be created from the undated reference PDF.
- No SISU TCSOL cycle may be created until campus-specific entities are reconciled.
- No 2027 degree deadline, tuition or application fee may be inferred from 2026 values.
- CQU President Scholarship insurance must remain unknown while the official conflict exists.
- CQU ICLT must not expose an open application CTA until an official opening date or active route is verified.
- Historical scholarship records with expired deadlines must not be presented as current opportunities.
