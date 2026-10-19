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
