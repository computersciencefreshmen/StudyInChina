# Decision-fact depth wave — 2026-08-25

## Decision

This wave is approved for four institutions: Zhejiang University, Hunan University of Technology and Business, Hangzhou Dianzi University and Guangzhou University. It deepens 18 program identities and six scholarship records using only official university sources checked on 2026-08-25.

All materialized 2026–2027 rounds are closed as of the evaluation date. They remain `verified` evidence with `dateStatus: published`; none is represented as open, rolling or as a fabricated 2027 round.

## Architecture position

`official university page/PDF → idempotent importer → program identity + closed cycle → schema/regression gates → versioned catalogue release`

The importer preserves existing program IDs and slugs, matches new identities semantically before insertion, and is byte-idempotent across `sources.json`, `programs.json`, `admission-cycles.json` and `scholarships.json`.

## Official source ledger

| Institution | Official source | Facts used |
| --- | --- | --- |
| Zhejiang University | [2026 undergraduate guide](https://iczu.zju.edu.cn/admissionsen/2024/1030/c68988a2981659/page.htm) and [English undergraduate catalogue](https://iczu.zju.edu.cn/_upload/article/files/e7/8c/1be7b2df433fb9427df707571d84/f8f1cb33-05a5-4fec-a602-3eac6caf8e14.pdf) | MBBS and Biomedical Engineering identity, duration, language, subject/language requirements, tuition, deadline and CNY 800 application fee |
| Zhejiang University | [2026 master guide](https://iczu.zju.edu.cn/admissionsen/2024/1030/c68989a2981849/page.psp), [English master catalogue](https://iczu.zju.edu.cn/_upload/article/files/32/c1/d48dfe1349279755c872b98ce7e1/aae5a919-1f07-4115-bb1c-db41ea36e1b0.pdf) and [graduate language requirements](https://iczu.zju.edu.cn/_upload/article/files/32/c1/d48dfe1349279755c872b98ce7e1/58e973ef-c184-4851-a78b-e72c230d213a.pdf) | MCS, iMBA, iMF and iMDS duration, language, tuition, deadline, application route, English requirement and ZIBS Hai Scholarship scope |
| HUTB | [2026 international student guide](https://iec.hutb.edu.cn/xwzx/tzgg/content_90133) | International Business and Chinese Language duration, tuition, language, application route, deadline and three conservative scholarship routes |
| HDU | [2026 application guideline](https://intedu.hdu.edu.cn/intedu_en/2026/0317/c13972a290327/page.htm) and [student regulations](https://intedu.hdu.edu.cn/intedu_en/13986/list.htm) | Nine-program pack, undergraduate duration, language requirements, tuition, deadline, application route and SONIS degree-only scope |
| Guangzhou University | [2026 Public Administration guide](https://gupa.gzhu.edu.cn/info/1299/19339.htm) | 48–84 month duration, Chinese/HSK requirement, email-only route, zero application fee, tuition range, deadline and scholarship tier |

## Materialized facts

- ZJU: six programs; tuition is CNY 42,800/year for MBBS and Biomedical Engineering, CNY 66,000/year for MCS, CNY 218,000/program for iMBA, CNY 180,000/program for iMF and CNY 50,000/year for iMDS. All six close on 2026-05-31.
- HUTB: International Business is 36 months and CNY 24,000/year; Chinese Language is 12 months and CNY 11,000/year. Both close on 2026-06-30.
- HDU: six bachelor programs are 48 months; the reviewed source does not publish a safe duration for Mechanical Engineering master, International Chinese Language Education master or Chinese Language non-degree, so those remain null. All nine close on 2026-06-15.
- Guangzhou University: Public Administration is 48 months with an 84-month maximum. The official CNY 18,000–20,000 annual tuition remains a localized range note, not a fabricated scalar value. The application fee is explicitly zero and the 2026-04-30 round is closed.

## Safety invariants

- HUTB's CNY 500 and HDU's CNY 600 charges are registration fees. Both retain `applicationFeeCny: null`.
- Guangzhou University accepts this application by email; no web application URL is invented.
- SONIS links only to degree programs; the Chinese-language non-degree route is excluded.
- ZIBS Hai coverage remains unknown because the reviewed sources confirm eligibility, not a safe award amount.
- The unsupported draft `cycle-2027-zhejiang-university-business-administration-master` is removed when the preserved program entity is refined to iMBA.
- Every new program name contains `en`, `zh`, `ru`, `de`, `fr` and `es`.

## Reproduction and gates

```powershell
node scripts/ingestion/apply-decision-facts-wave-2026-08-25.cjs
npx vitest run tests/unit/decision-facts-wave-2026-08-25.test.ts
npm run validate:data
```

The importer was executed twice and produced identical SHA-256 hashes for all four generated data files.
