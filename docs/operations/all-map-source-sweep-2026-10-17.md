# First all-map official-source sweep — 2026-10-17

The first finite source sweep attempted every one of the **255 universities currently displayable on the published map**, exactly once. It completed at **2026-10-17 06:09:17 UTC / 14:09:17 Asia/Shanghai**. This is a local working-tree operations result, not a claim about the production catalogue, nationwide university coverage, or newly verified admissions facts.

The 17 additional raw universities hidden from the published map are present in the coverage ledger but were outside this capture scope. The 13 completed batches contained 20 universities each for batches 1–12 and 15 universities in batch 13. The empty batch-014 plan was generated as a terminal check and was not executed.

## Actual results

| Measure | Result |
| --- | ---: |
| Completed capture runs | 13 |
| University attempt rows | 255 |
| Distinct attempted university IDs | 255 |
| Missing, duplicate, or outside-scope university IDs | 0 each |
| Universities with captured material pending review | 214 |
| Universities held without a successful source capture | 41 |
| Source observations | 507 |
| Captured observations | 369 |
| Unchanged observations | 22 |
| Blocked observations | 27 |
| Failed observations | 89 |
| Candidate link appearances across reports | 2,490 |
| Distinct candidate URLs | 2,108 |

An observation is a logical source result, not a total HTTP request count: robots checks and redirects can add requests. A university can have a successful source and a failed second source, so university status and observation status have different denominators. Candidate URLs are unverified admissions/catalogue links extracted from approved official hosts; they are **not programme counts or certified facts**. An unchanged hash records another observation and never renews a programme, cycle, eligibility rule, or verification date.

Within this source-only sweep, paid model calls, fact certifications, cloud database writes, canonical catalogue writes, and publication actions were **all zero**. Separate publication work elsewhere in the project is outside this report.

## Held and failed reasons

These 116 observations equal the 27 blocked plus 89 failed observations. The recorded reason is retained rather than replaced by a generic success flag.

| Recorded reason | Observations |
| --- | ---: |
| `robots_unavailable` | 55 |
| `robots_http_403` | 20 |
| `source_http_412` | 10 |
| `network_or_deadline_failure` | 8 |
| `body_too_large` | 7 |
| `source_http_404` | 4 |
| `robots_disallow` | 3 |
| `robots_http_500` | 2 |
| `source_http_403` | 2 |
| `source_http_410` | 2 |
| `unsafe_source_or_redirect` | 2 |
| `robots_http_502` | 1 |

The collector enforced HTTPS, credential-free URLs, approved official hosts, public DNS resolution, manual redirects restricted to approved hosts, and robots policy. It did not bypass refusals. Limits were at most two URLs per selected university, two concurrent universities, at least five seconds between requests to a domain, 2 MiB per response body, and a 20-second request deadline. An approved URL that could not safely be fetched remains unresolved.

For the two schools that prompted the maintenance work:

- **Sun Yat-sen University:** both planned official sources were held on `robots_http_403`. The source pages themselves were not fetched through a bypass. This sweep therefore supplies no new programme facts for the school.
- **Guangdong University of Foreign Studies:** both planned official sources returned HTTP 200 and were preserved. Seven candidate links were extracted from the admissions page, including undergraduate, master's, doctoral, programme introduction, and admissions-guide sections. These await content review; capture alone does not establish that a particular intake or application is open.

## Durable local evidence and database consistency

The queryable database is `.tmp/university-maintenance/maintenance.sqlite`. It is a **local maintenance ledger**, not the factual catalogue database or a replacement for the website's data backend. JSON execution state is authoritative for scheduling; SQLite is its auditable query mirror.

| Ledger/state check | Audited result |
| --- | ---: |
| Active map university rows | 255 |
| Hidden university rows | 17 |
| Maintenance run rows | 13 |
| Coverage history rows | 3,536 = 272 × 13 |
| University attempt rows | 255 |
| Source observation rows | 507 |
| JSON execution state revision | 13 |
| JSON execution state attempt entries | 255 |
| Terminal eligible / selected universities | 0 / 0 |
| Universities in terminal cooldown | 255 |

For each batch the sequence was: preserve the original plan, capture, validate and sync that **original plan plus report** into SQLite, then record the receipt in JSON execution state. Therefore the ledger coverage head correctly references the final capture plan's pre-attempt state revision **12**, while the authoritative execution state has advanced to **13**. Final attempt results are already in the ledger. Ingesting the empty terminal plan just to align these revision numbers would add an unnecessary fourteenth run and is not part of this audit.

- Final capture plan SHA-256: `dcaaa5d50c6307999d3e1001c9e32744010d839fd71f46adf68aed43b044146c`.
- Shared input SHA-256: `2880f41cc239a82f2d13d5c0f0dcdf5001b81b5377fe81dbc99babda91280c82`.
- Empty terminal plan: `.tmp/university-maintenance/batch-014-plan.json`, SHA-256 `c860907c9c2b3d2cd9d33550fb7d6f501c74cd0e15d9b013700bb98cbe0a1fcc`.
- Authoritative state: `.tmp/university-maintenance/current-state.json`.
- Machine audit: `.tmp/university-maintenance/sweep-final-summary.json`.

All 13 completion headers and their hash checkpoints were verified. There were 507 source-start markers and 507 terminal source checkpoints, with no incomplete markers. The capture lock and state lock were absent at the audit. SQLite used `journal_mode=delete`, was closed after the read-only audit, and had no `-wal` or `-journal` sidecar. This is a completed finite pass; no subsequent day's repeats were started.

Each original plan remains with its report, result receipt, completion header, raw bytes, robots evidence, and source checkpoints under the ignored local directory `.official-harvest/university-maintenance/<planSha256>/`. Keep that evidence and the JSON state together with the SQLite snapshot when backing up or restoring. Raw response content and private local artifacts are deliberately not embedded in this committed report.

## Reproduce the local count checks

Run from the repository root with Node.js 24. The built-in `node:sqlite` module reads this local ledger without cloud credentials or network calls. The script opens SQLite read-only and closes it in `finally`; it does not capture sources, record attempts, ingest reports, or modify the catalogue. The experimental SQLite warning on this Node version is expected.

```powershell
@'
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const summaryPath = '.tmp/university-maintenance/sweep-final-summary.json';
const statePath = '.tmp/university-maintenance/current-state.json';
const terminalPath = '.tmp/university-maintenance/batch-014-plan.json';
const databasePath = '.tmp/university-maintenance/maintenance.sqlite';
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const terminal = JSON.parse(fs.readFileSync(terminalPath, 'utf8'));
const db = new DatabaseSync(databasePath, { readOnly: true });
let audit;
try {
  const one = sql => db.prepare(sql).get();
  const all = sql => db.prepare(sql).all();
  audit = {
    attempts: one('SELECT COUNT(*) AS rows, COUNT(DISTINCT university_id) AS universities FROM university_attempts'),
    duplicates: all('SELECT university_id, COUNT(*) AS n FROM university_attempts GROUP BY university_id HAVING COUNT(*) <> 1'),
    missing: all("SELECT university_id FROM university_coverage WHERE active=1 AND university_id NOT IN (SELECT university_id FROM university_attempts)"),
    outsideScope: all('SELECT DISTINCT a.university_id FROM university_attempts a LEFT JOIN university_coverage c ON c.university_id=a.university_id WHERE c.university_id IS NULL OR c.active<>1'),
    runs: one('SELECT COUNT(*) AS n FROM maintenance_runs'),
    runStatuses: all('SELECT status, COUNT(*) AS n FROM maintenance_runs GROUP BY status'),
    coverage: all('SELECT active, visibility, COUNT(*) AS n FROM university_coverage GROUP BY active, visibility'),
    history: one('SELECT COUNT(*) AS n FROM coverage_history'),
    observations: one('SELECT COUNT(*) AS n FROM source_observations'),
    outcomes: all('SELECT outcome, COUNT(*) AS n FROM source_observations GROUP BY outcome ORDER BY outcome'),
    processing: all('SELECT processing_status, COUNT(*) AS n FROM university_attempts GROUP BY processing_status ORDER BY processing_status'),
    reasons: all('SELECT error_code, COUNT(*) AS n FROM source_observations WHERE error_code IS NOT NULL GROUP BY error_code ORDER BY n DESC, error_code'),
    head: one('SELECT * FROM ledger_head WHERE singleton=1'),
    journalMode: one('PRAGMA journal_mode'),
    stateRevision: state.revision,
    stateAttempts: Object.keys(state.attempts).length,
    terminal: terminal.summary,
    candidateAppearances: summary.candidateCount,
    distinctCandidateUrls: summary.uniqueCandidateUrls,
  };
  if (audit.attempts.rows !== 255 || audit.attempts.universities !== 255 ||
      audit.duplicates.length || audit.missing.length || audit.outsideScope.length ||
      audit.runs.n !== 13 || audit.history.n !== 3536 ||
      audit.observations.n !== 507 || state.revision !== 13 ||
      audit.stateAttempts !== 255 || terminal.summary.eligible !== 0 ||
      terminal.selectedUniversityIds.length !== 0) {
    throw new Error('Local sweep audit differs from the documented terminal snapshot');
  }
} finally {
  db.close();
}
audit.sidecarsAfterClose = {
  wal: fs.existsSync(databasePath + '-wal'),
  journal: fs.existsSync(databasePath + '-journal'),
  captureLock: fs.existsSync('.official-harvest/university-maintenance/capture.lock'),
  stateLock: fs.existsSync(statePath + '.lock'),
};
console.log(JSON.stringify(audit, null, 2));
'@ | node
```

Candidate counts above are read from the final machine audit, which summed link appearances across the 13 preserved reports and deduplicated candidate URL strings. SQLite stores source observations and attempt history, not candidate-link content. The immutable plan/report/checkpoint validation was performed separately before producing that audit; SQL row counts alone do not certify source content.

## Next operational step

Review captured official admissions/catalogue material and candidate links, starting with schools that have no current programmes. Resolve held schools through permitted official sources or manual review rather than automatic retries around a refusal. Only after a reviewer checks the actual programme, intake, degree, language, eligibility, dates, and evidence should a proposed catalogue change enter the existing validation/publication process. A published cycle is not necessarily an open application: its deadline may already have passed. Raw eligibility prose is not a reviewed typed rule, and this sweep supports no admission-probability estimate.

Future scheduled source checks should use the durable state and backoff policy. A retry, a successful HTTP response, or an unchanged document does not by itself justify renewing factual verification dates. Nationwide university discovery remains a separate scope from these 255 currently mapped schools.
