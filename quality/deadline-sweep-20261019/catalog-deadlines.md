# Catalogue deadline sweep: 2026-10-19

This is an automated inventory of stored structured dates, **not new official website verification**. Official pages read in this run: **0**. The cutoff is inclusive in Asia/Shanghai. An expired intake is historical reference; it is not evidence that the program stopped operating.

Input: `C:\Users\Henry\Desktop\学过的课程\github_profile_work\StudyInChina\content\data`

Snapshot SHA-256: `ae492658e03f2aaf768cbde6ba3d80a3c8cb24d33b17f88a9743bd67b1f85722`

| Scope | Universities | Programs | Admission cycles | Scholarships |
|---|---:|---:|---:|---:|
| Raw | 272 | 2057 | 1654 | 400 |
| Published by current gate | 255 | 783 | 783 | 7 |

## Stored admission windows

| State | Count |
|---|---:|
| unknown | 489 |
| open | 290 |
| closed | 274 |
| previous-cycle-reference | 23 |
| future | 487 |
| deadline-not-passed | 87 |
| rolling | 4 |

## Stored scholarship windows

| State | Count |
|---|---:|
| unknown | 335 |
| closed | 16 |
| deadline-not-passed | 49 |

Open requires both a nonfuture opening date and an unexpired deadline. Deadline-not-passed has a stored unexpired deadline but no structured opening date. Unknown and rolling require official rechecks. All classifications are per stored intake.

## Resumable official recheck queue

14 school batches of at most 20, covering all 272 raw identities and 255 published identities. 1 additional batches cover 2 scholarships without university attribution. Schools with current windows and unresolved dates come first.

Use `catalog-deadlines.json` for exact IDs, university links, per-record source URLs and batch membership. Its `officialRecheckPages` deduplicates 822 official date source pages (150 with current windows), so one page read can support multiple matching intake records. Record actual official-page findings in `official-recheck-progress.json`; completion receipts require URL, accessed date and the official deadline wording. Keep this progress file when rerunning. Deploy and push each completed reviewed batch, recording commit and deployed URL. The generator changes no canonical data.

| Batch | Schools | Public | Programs | Cycles | Scholarships | Current windows | Unknown/rolling |
|---|---:|---:|---:|---:|---:|---:|---:|
| schools-01 | 20 | 20 | 925 | 907 | 48 | 839 | 51 |
| schools-02 | 20 | 20 | 113 | 99 | 45 | 39 | 74 |
| schools-03 | 20 | 20 | 93 | 70 | 29 | 30 | 39 |
| schools-04 | 20 | 20 | 117 | 105 | 48 | 3 | 133 |
| schools-05 | 20 | 20 | 101 | 87 | 35 | 0 | 119 |
| schools-06 | 20 | 20 | 98 | 81 | 31 | 0 | 100 |
| schools-07 | 20 | 20 | 95 | 60 | 39 | 0 | 84 |
| schools-08 | 20 | 20 | 85 | 60 | 33 | 0 | 74 |
| schools-09 | 20 | 20 | 82 | 51 | 24 | 0 | 59 |
| schools-10 | 20 | 20 | 84 | 20 | 30 | 0 | 40 |
| schools-11 | 20 | 20 | 93 | 38 | 22 | 0 | 28 |
| schools-12 | 20 | 20 | 84 | 38 | 11 | 0 | 13 |
| schools-13 | 20 | 15 | 65 | 25 | 14 | 2 | 22 |
| schools-14 | 12 | 0 | 22 | 13 | 9 | 0 | 16 |
