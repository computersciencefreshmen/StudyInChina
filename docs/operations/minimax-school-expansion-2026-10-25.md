# MiniMax execution and school coverage expansion

The immediate priority is increasing the number of schools with usable programme directories. The approved execution cohort remains 272 schools. The national registry is a separate discovery backlog; its institutional identities alone do not establish international admissions.

## Actual result and current limit

The 25 October batch made **six MiniMax-M3 subscription requests**, using 19,010 input tokens and 8,671 output tokens. Four official documents were captured. A parser correction reused all completed responses without another paid request. Twelve Peking University programme identities passed independent extraction agreement and the canonical importer's source, quote, identity and review checks.

| Measure | Current canonical data | Accepted candidate preview |
| --- | ---: | ---: |
| Fixed school cohort | 272 | 272 |
| Schools with directory programmes | 17 | 18 |
| Directory programmes | 783 | 795 |
| Schools with current application opportunities | 9 | 9 |
| Current opportunity programmes | 738 | 738 |

**The preview has not been published.** Cloud D1 is still returning an explicit exhausted daily read allowance. Its reported reset is 26 October 2026, 00:00 UTC / 08:00 Asia/Shanghai. Successful transfer, candidate acceptance and stable website publication are separate states.

The frozen handoff contains 57 artifacts, 62 typed database rows and six completed model reservations. The receiver's manifest pointer and `held_for_handoff` fence were read back successfully. Scheduled cloud ticks requeue the immutable handoff after backend recovery. Only verified D1 import and reservation adoption release the execution fence; the existing canonical writer and protected publisher then handle the 12 candidates.

See the [machine-readable run receipt](../../quality/maintenance/2026-10-25/direct-minimax-school-expansion.json). This batch does not establish complete inspection or catalogue reconciliation for any of the 272 schools.

## School-first expansion

`maintenance:school-queue` measures the safe directory projection, including identity and field evidence. Raw programme counts are retained as diagnostics. The current priority hint places the 255 schools without accepted directory programmes before the 17 already covered schools.

Cloud rollout uses this priority only after its existing inspection, publication, lease and unresolved-request checks pass. Uninspected schools run first, followed by coverage rank. Each next cohort adds 20 schools to the existing scope. Foreign, incomplete or invalid priority hints preserve the original order. A hint can be stale because it only chooses collection order; it never accepts a fact or proves that an entire catalogue is complete.

The next cohort begins with Harbin Institute of Technology, Sun Yat-sen University, University of Science and Technology of China, Jinan University, Hangzhou Dianzi University and Southwest University. Official URLs in the queue remain collection leads; historical STOP/unknown reservations must still be checked before each model request.

The [next-20 source preflight receipt](../../quality/maintenance/2026-10-25/next-20-source-preflight.json) records actual checks of 40 approved leads. Seventeen schools yielded 33 complete source bodies, including five PDFs. Sun Yat-sen University was held on robots HTTP 403, USTC on an HTTPS-to-HTTP redirect, and Wuhan University of Technology on a robots connection timeout. These checks performed no model calls or programme acceptance. The corrected evidence archive is in the existing R2 snapshot bucket under `maintenance/preflight/school-expansion-2026-10-25/e01b6616297f086b2333e733d9c47488c198ed2f0480cdb1ff721be7b4a32634.tar.gz`; its 2,726,991 bytes were downloaded again and SHA-256 checked. The earlier invalid transport diagnostic is excluded from this archive.

## Temporary execution staging

The cloud ledger's allowance prevented paid work from starting. The temporary local adapter uses the production capture, admission, extraction and validation engines, backed by fsynced SQLite journals and immutable evidence blobs. It preserves the full 3,509-entry historical guard ledger and checks its exact immutable cloud seed before a new execution. Credentials stay outside repository files and reports.

A global cloud Durable Object owns the execution fence. It is an account-wide coordinator that serializes ownership even while D1 is unavailable. Local requests check that ownership immediately before a model POST. A request is durably marked `send_started` before sending; an unknown outcome cannot authorize a retry.

The local database is temporary execution staging, not a second public catalogue. The handoff receiver accepts a fixed table/column schema, verifies artifact hashes, preserves completed and unknown requests, and imports in bounded checkpoints. Unknown requests also receive server-derived source/snapshot guards. It cannot replace controls, targets, historical guards or arbitrary SQL through an uploaded manifest.

## Commands and recovery

```text
npm run maintenance:school-queue
npm run maintenance:local -- --execute
npm run maintenance:stage
npm run maintenance:stage -- --upload
```

The execution command requires the existing pinned seed, verified source manifest, current MiniMax-M3 provider and maintenance admin environment. The staging command defaults to packing and freezing without uploading. Actual private paths and credentials are intentionally not documented here.

- Never create a fresh local directory to escape an unknown reservation or stale process lock.
- A frozen `handoff.json` prevents further local execution; resume its exact upload instead.
- Transport retries reuse immutable object keys and upload receipts. They do not repeat model requests.
- A rejected quote or unsupported translated name remains excluded. Per-locale validation can retain another independently supported official name.
- New scholarship identities do not automatically establish annual amounts, deadlines or programme applicability. This batch leaves scholarship outputs staged for later review while school coverage takes priority.

Verification includes the real 12-candidate importer check, 1,883 unit tests (one existing skip), 79 Worker regressions, TypeScript and ESLint. The final Worker deployment `b37f74e1-4ceb-4149-be5a-670576948972` also holds global operation permits during export, read and acknowledgement, preventing a prepared batch from escaping before handoff completes. Stable website publication and the seven-day unattended maintenance soak remain unverified.
