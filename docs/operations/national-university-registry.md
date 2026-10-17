# National institution discovery targets

Rebuild from the preserved original MOE files, without changing the public catalogue:

```powershell
python -m pip install --disable-pip-version-check --no-input --target .tmp/national-registry-python xlrd==2.0.2
node --import tsx scripts/automation/build-national-university-registry.ts --python-module-dir .tmp/national-registry-python --today 2026-10-17 --output content/targets/national-university-registry.json
node node_modules/vitest/vitest.mjs run tests/unit/national-university-registry.test.ts
```

The importer reads legacy binary XLS with the pinned Python `xlrd` reader; it does not install anything itself or call a model. Python 3 and the documented isolated `xlrd==2.0.2` install are required only to rebuild the annual master artifact. The default source directory is `content/targets/sources/moe-2026`; all four original public source files are committed (about 551 KB combined), so a clean checkout can replay without fetching MOE again. Other inputs may be selected with `--capture-dir`, `--receipt`, `--data-dir`, `--python` and `--python-module-dir`. An isolated replay can use `--output .tmp/national-registry-replay.json`. The importer does not silently download, replace or guess sources. Normal scheduled discovery only needs the committed registry and Node; rebuilding the annual master list is a separate source acquisition step.

## Source and scope

The [Ministry of Education nationwide higher education list](https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/t20260618_1441074.html), published **2026-06-18** and effective **2026-06-17**, contains **3,196 institutions**:

| Official list | Institutions | Operational category |
| --- | ---: | --- |
| General: bachelor level | 1,412 | `bachelor-level` |
| General: higher vocational/junior college | 1,540 | `higher-vocational-junior-college` |
| Adult higher education | 244 | `adult-higher-education` |
| Total | 3,196 | All receive a pending discovery task |

The official list explicitly excludes Hong Kong, Macao and Taiwan. It includes general universities, colleges and vocational institutions rather than only institutions with “大学” in their names. Preserve special remarks, including cooperative institutions and overseas institutions established in Hainan, as printed. The MOE file does not establish whether an institution accepts international applicants. Adult institutions are separately categorized; no international admission eligibility is inferred for either category.

Original XLS links are [general institutions](https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/W020260618416094865984.xls) and [adult institutions](https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/W020260618307096079727.xls). The small committed `content/targets/national-university-registry.sources.json` records exact URLs, actual final URLs, HTTP status, capture timestamps, byte counts and SHA256 of the original committed HTML/XLS bytes. An acquisition working copy also remains under `.official-harvest/national-university-registry/2026`, but is not necessary for replay. Captured on 2026-10-17, the official server redirected HTTPS to the same MOE host over HTTP; receipts retain this transport limitation. Hashes establish replay identity, not cryptographic publisher authentication. Robots returned 404; no access block was bypassed. These files contain public official source bytes and no applicant data. The importer reads them as data; they are not served by the website.

## Identity and current coverage

The 2026 registry reconciles **272 current raw catalogue identities**: **271 exact Chinese names** and **one documented rename**, with **zero unmatched local identities**. The [MOE rename decision](https://www.moe.gov.cn/srcsite/A03/s181/202306/t20230616_1064609.html) binds local `上海体育学院` to official `上海体育大学`, code `4131010277`. This is an explicit alias only; it does not alter the local university record. No fuzzy matching, translated-name matching, punctuation replacement or guessed merger is allowed.

**2,924 listed institutions are absent from the current raw catalogue**: 2,680 general institutions and all 244 adult institutions. Their official identity is a discovery target, not a verified public university or an admission claim.

At `--today 2026-10-17`, the full canonical bundle evaluated by the same `selectPublishedData` function used by the website has **255 public universities**, **17 hidden identities**, **7 universities with 755 current public programmes**, and **248 public universities with zero current public programmes**. There are 755 current public admission-cycle records. These counts describe local catalogue coverage, not national availability or confirmed open applications at every institution. The registry records the evaluation date and a digest over all six source catalogue files. Rebuild to refresh that snapshot; do not treat the stored October counts as timeless.

## Operational contract

`content/targets/national-university-registry.json` is an operational artifact, separate from `content/data`. It exposes:

- `nationalCoverage`: list totals, exact/alias matches, missing targets and independently evaluated current public catalogue coverage.
- `institutions`: one row per ten-digit MOE institution code; original name, province heading, literal location, department, level, remarks, source sheet and one-based Excel row are retained. Adult location and level remain null because that file does not supply them. `catalogueMatch.publicCoverage` reports existing catalogue visibility and programme counts.
- `discoveryQueue`: exactly 3,196 deterministic tasks, each with a stable `moe-<code>` target ID, category, optional catalogue university ID, `status: pending` and `nextAction: discover-official-international-admissions-source`.
- `knownSourceCandidates`: existing catalogue admissions/official URLs only, labelled `existing-catalogue-unchecked` and `verificationStatus: unknown`. A missing URL produces an empty list; no institution host or admission route is invented.

Every row initially has `internationalAdmissionsStatus: unknown` and `currentProgramsStatus: unknown`. The registry certifies zero international admission facts or current programmes. Existing public programme counts are reported separately. Reading this queue, discovering sources, capturing bytes, extracting programme facts, verifying dated evidence and public publication remain distinct operations. An hourly consumer must retain missing-source tasks and durable attempt state; it must not claim nationwide source acquisition merely because 272 existing catalogue entries have URL candidates.

## Validation and maintenance

The adapter fails closed on changed worksheet titles, dates, headers, unknown education levels, row ordinals, province subtotals, duplicate names/codes, ambiguous catalogue identities or national counts that disagree with the announcement. It validates actual announcement publication/as-of dates, exact resolved attachment links, captured source hashes/byte counts and an exact name/code-bound alias statement. File operations reject workspace escapes and symlink/junction paths, and output is restricted to JSON under `content/targets`, `.tmp` or `quality`. The XLS subprocess has a 30-second limit.

For a future official annual release, capture its announcement and both linked files normally, preserve their true capture receipts, update expected source dates/counts and acquire separate explicit rename evidence where needed. Run tests and inspect unmatched identities before replacing the operational artifact. A newly published national list does not renew any public university, programme, fee or application date; those require independent official international-admission evidence.
