# Deadline-first catalogue maintenance — 19 October 2026

The owner changed the immediate priority to checking official application dates and whether an intake has closed. Fees, teaching medium, materials and other fields are deferred unless needed to understand the date's scope. Each qualified change batch should be pushed to GitHub and published, then maintenance should continue without another reminder.

## Data and deployment boundaries

The current `D:/学过的课程/github_profile_work/StudyInChina` checkout contains an older application tree with unrelated local changes. The restored current catalogue, PR40 and protected publishing tools are in `C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina`. Do not deploy the old D application tree or stage its unrelated changes. This new script and its audit artifacts can be copied into the current checkout using an explicit file allowlist.

The current chat resumed the stopped publisher after the previous chat reported `systemError`. The takeover receipt preserves the previous state hash and owner. During candidate verification and promotion the continuation state remains exclusive; future maintenance must read its current owner and release flag.

## Date audit method

`scripts/quality/audit-catalog-deadlines.ts` reads six catalogue files, records their SHA-256 hashes and classifies each stored admission and scholarship deadline using an inclusive Asia/Shanghai calendar date. A deadline equal to today remains valid through the end of today. Missing opening dates do not prove applications are open. Unknown and rolling dates require an official check. A closed intake does not establish that the programme has permanently stopped.

The 19 October snapshot contains 272 universities, 2,057 programmes, 1,654 admission cycles and 400 scholarships. It has 274 expired cycle deadlines and 16 expired scholarship deadlines. Historical records and original evidence remain in the catalogue. The existing publication projection already excludes known expired opportunities; no unchanged-date rewrite or repeated deployment is needed.

This inventory is an automated check of stored dates, not a new official verification of all facts or all universities. Its report explicitly records zero new official page readings. Separate official-batch receipts record actual page reads, date wording, applicable academic year and record IDs, along with conflicts and access failures. Do not renew an entire record's `verifiedAt` or `reviewAfter` merely because its date was checked.

## Efficient continuation

The queue covers all 272 raw identities in fourteen batches of at most twenty schools, plus the unattributed scholarship batch. It includes 822 distinct official source pages; 150 have current or future windows. Read shared official notices once, then bind the exact date and scope to every supported record. Prefer current and near-deadline opportunities, then unknown/rolling dates, while preserving checkpoints for all remaining schools. A single page or route does not complete a school's catalogue.

Run against the current catalogue from the current checkout:

```powershell
node --import tsx scripts/quality/audit-catalog-deadlines.ts --today 2026-10-19 --batch-size 20
node --import tsx scripts/quality/audit-catalog-deadlines.ts --self-test
```

Keep `quality/deadline-sweep-20261019/official-recheck-progress.json` on reruns and compare snapshot hashes before reusing receipts. Date-only changes require official evidence and independent review; unchanged results can be committed as evidence without rebuilding the website. Failed access and conflicting years remain unresolved rather than being treated as open, closed or corrected.

## Publication and recurring execution

The already approved sixteen-programme/seven-scholarship batch is PR40 at source commit `0cb2b83dde6116907752ec60a165fedc6f3f203f`. Its frozen candidate is `dpl_H3ySH4TmzdEP1JFmec4jxsJuQgwn`. Its previous empty smoke directory is retained; the resumed complete check uses `candidate-smoke-v2`. Do not replay approved or held batch identities.

Only a fresh complete candidate proof may enter the shared reserve/claim/guard/alias/readback/ack publisher. Retain the previous stable deployment and save exact candidate and stable readback receipts. Never deploy a dirty checkout or use a direct alias command. The website remains JSON; this work does not migrate or write D1. Global coverage checks remain honest about the 238 schools without current programmes in the prepared projection.

The existing `studyinchina-minimax` heartbeat was updated in place to the date-first scope and this chat, retaining its fifteen-minute cadence. It must remain quiet on unchanged results and report real releases, completion, important failure or required user action. Existing MiniMax paid STOP scopes, unknown outcomes, permanent reservations and non-replay constraints remain in force; this sweep uses free official source reads and local deterministic checks.

## Validation

The date script passed eleven deadline/calendar boundary assertions, scoped ESLint and isolated TypeScript checks. The prepared batch's approval, snapshot-write and public-smoke unit tests passed: four files, 81 tests. Broader historical/strict-coverage failures are separate and must not be described as green or bypassed by altering factual data.

## Published batch and official-date progress

The protected publisher completed at 2026-10-19T04:34:19.716Z with command `abac19e9-0ceb-4405-9b8a-644b77d53211`. Production now uses `dpl_H3ySH4TmzdEP1JFmec4jxsJuQgwn` from exact source `0cb2b83dde6116907752ec60a165fedc6f3f203f`; the previous `dpl_EUkxVddCJFkt2KvLso15TdCEDCht` is retained. Candidate and stable proofs both passed all 255 university pages, 96 localized programme details and 42 localized scholarship details with zero errors, console errors or cleanup notes. Stable proof SHA256: `c9fc2c4689ffcea38fea8844f6f7ef3fa9028ffc2c36b4fc8bb1f7eee5b8a218`. The public API independently returned 783 programmes/cycles and seven scholarships. It still returns `deploymentSha=null`; exact source identity is established by native metadata and the frozen Git source plan.

Four official date-only batches attempted 40 distinct schools and assessed 70 selected record dates: 56 unchanged, six unresolved and eight blocked. No date corrections or whole-record renewals were applied. These are selected-route checks, not 40 complete school catalogues. The unchanged results are pushed as evidence; they do not require another website deployment. Tsinghua's 11:00 Beijing cutoff and Qingdao's before-date wording remain explicit in the precision issues. The next run must use the exact pending IDs and page groups in the shared progress file.

## Deadline batches 005–008 and current public projection

The latest immutable summary is `quality/deadline-sweep-20261019/official-review-summary-v3.json`; resolve future state through the `deadlineMaintenance.summary` and progress `dateRechecks.summaryFile` pointers instead of assuming v2 stays current. Eight source batches have assessed 834 distinct cycle/scholarship dates across 44 schools: 819 unchanged, six unknown, eight blocked and one source conflict. Batches 005–008 add 764 current-public-cycle assessments and have separate independent review receipts.

All 783 currently public cycles now have an assessment or still-matching approved date evidence: 782 are date-supported (766 source-batch checks and 16 separately labelled prior-approved evidence reuses); one SIGS route remains conflicting. Its programme-specific official bilingual catalogue says May 17,2027 at17:00 while the general SIGS guide says May15 at17:00. Both originals and the existing disclosure are retained; no automatic date change or precedence is asserted. Three of seven public scholarships still lack a separately announced award deadline; their doctoral admission date is not substituted. Unknown opening dates remain unknown.

Official 17:00 cutoffs and before-date wording remain explicit report qualifiers. The calendar-date inventory does not certify availability after an official intraday cutoff. Checking all current public cycle dates is not completion of all raw school catalogues or recertification of fees, language or materials. No canonical facts changed and the live 783-programme/seven-scholarship deployment remains the previously verified release. No duplicate website build is required for unchanged-date evidence.

`next-official-date-targets-v1.json` selects 41 unassessed unexpired records across the next twenty schools; 63 such records remain in total. There are 1,201 raw cycle/scholarship records outside the cumulative assessed/prior-approved set, including preserved historical/expired and unknown-date records. Continue current/future windows, then unknown/rolling scopes and remaining identities without replaying already checked evidence.

The audit generator now reuses a complete identical snapshot/date/options bundle byte-for-byte, including user-maintained progress and original file times. Changed inputs/date/options or a partial bundle require a unique `--output-dir`; never overwrite an older inventory whose hash is cited by a source receipt. Five preservation tests, thirteen summary normalization assertions and scoped lint passed.

Before a new writer starts, verify the continuation state is committed and has no staged or unstaged difference from HEAD, and that HEAD matches upstream. This closes the handoff window between recording release metadata, committing it and pushing. Preserve unrelated local changes.

## Deadline batches 009–012 and next unknown-date scopes

The current cumulative pointer is `quality/deadline-sweep-20261019/official-review-summary-v4.json`: twelve immutable reports assess 897 distinct dates across 64 schools, with 861 unchanged, 11 unknown, 18 blocked and seven held conflicts/differences. The four new independently reviewed batches add 63 records (42 unchanged, five unknown, ten blocked and six conflicts). Existing public coverage remains 782 date-supported cycles and one previously disclosed SIGS conflict, with three independent scholarship deadlines still unknown. Source reuse is explicit and is not counted as a fresh official website reading.

All 63 previously unassessed explicit unexpired dates now have a review outcome; this is not 63 verified dates. The next finite queue is `next-official-date-targets-v2.json`: 20 further schools and 59 selected unknown/rolling date records, with 1,138 raw record dates outside the assessed/prior-approved set. A selected route still does not complete a school catalogue. Failed sources keep bounded cooldown and unknown dates are never treated as open or closed.

CQNU unpublished language cycle `cycle-cqnu-chinese-language-spring-2027` has a held correction candidate: both current school guides say December25,2026 while its stored date and historical note say December30. Batch012 preserves the old row hash, both originals and proposed narrow change. No factual mutation or public release was approved; use a supported narrow date consumer with new independent approval and current catalogue CAS, without replaying an older full-record consumer or renewing whole-record freshness. BFSU school/CLEC dates and intake wording conflict; SichuanNormal bilingual years conflict; SichuanInternational language March/May intakes need separate scope; DLUT recommends completion before end of June without proving a hard cutoff. These remain held.

Four independent review receipts passed with their evidence limitations retained. The cumulative reader now accepts exact identical compatibility aliases once, rejects differing duplicate IDs, validates scholarship full-row hashes, and treats scholarship opening wording as source context because no canonical scholarship opening field exists. Seventeen assertions, scoped lint and a fresh C-repository summary regeneration passed; the frozen inventory hash is unchanged. No canonical facts changed, no duplicate site deployment was made, and the existing JSON production release remains intact.

## Deadline batches 013–015: historical windows and unresolved scope

Current pointers are `official-review-summary-v5.json` and `next-official-date-targets-v3.json` under the date-sweep directory; future runs must resolve them from continuation state. Fifteen immutable source reports now assess 956 distinct record dates across 84 schools: 861 unchanged, 25 source-confirmed past windows, 43 unknown, 20 blocked and seven held conflicts/differences. Three new independently reviewed batches add 59 exact records at twenty further schools: 25 past-window observations, 32 unknown and two blocked. Twenty-four past-date observations were previously null canonical deadlines; one confirms an existing expired BSU CSC cutoff. All remain source-only observations/candidates, with original rows, status and freshness unchanged. No new canonical dates were applied or expired raw records silently filled.

The date findings preserve BFU admission June15 versus BGS June8, BIT general admission June1 versus scholarship May1, BSU non-degree June1 versus CSC master beforeMarch1, BTBU matching majors versus unmatched Finance, CAD undergraduate first-material March6 09:00 versus later stages and foreign-doctoral March6 17:00 versus HongKong/Macao/Taiwan web registration, and CUIT/CSU/CSUST/CDUTCM exact2026 routes. AHMU February25 is advice, BJTU actual guide cover is2018 despite its2024 URL, BISU guides are2024, AHU/BUPT/CCOM recurring month-day wording does not prove exact target-year hard cutoffs, and CDUTCM scholarship dates are separately announced. These limits are retained rather than rolling dates forward or substituting admission dates for awards.

Independent source-only reviews for013–015 passed with original-byte, record-row and year/route checks. The cumulative reader now rejects missing, invalid, same-day or future calendar-only closed assertions; intraday closure needs its own evidence. Twenty-one assertions, scoped lint and fresh C-root summary regeneration passed; frozen inventory bytes and all six canonical input hashes remain unchanged. Production remains the prior783-cycle/seven-award JSON release, with782 public cycle dates supported and one SIGS conflict; three award deadlines remain unknown. No duplicate deployment is needed.

The next finite queue has20 schools/51 exact records:45 originally unknown and six historical closed-date records sharing those source scopes. There are1,079 raw record dates outside the assessed/prior-approved set and no unassessed explicit unexpired dates in the frozen input. This does not mean all raw school catalogues are complete, all unknown dates are closed, or all future admissions have ended. Saved automation instructions now obtain all counts and queue versions from live committed-state pointers so old prompt counters cannot cause replay. Existing paid STOP scopes, held correction candidates and guarded publication requirements remain intact.
