# Production verification — 2026-08-30

## Website and data are separate releases

The stable site was verified at deployment SHA
`58470c8949fd8b379df637447481568e6599d12a` before this follow-up patch.
`/api/v1/releases/current` reported the JSON backend and release
`json:2026-08-26`, evaluated for 2026-08-30:

| Public entity | Count |
| --- | ---: |
| Universities | 266 |
| Programs | 1,265 |
| Scholarships | 366 |
| Cities | 62 |

These are published identity counts, not counts of open applications or
completely reverified records. The public admission-cycle count must not be
interpreted as dated-or-rolling coverage.

The Chinese/English program lists, Chinese scholarship list, and an Anhui
University program detail returned real application HTML. The redundant tuition
reference warning was absent; the detail retained official-source links.

The follow-up patch aligns JSON list, comparison, and page-list
`evaluatedForDate` with the actual query clock. Selection already used that clock.
It does not refresh `verifiedAt`, `dataCheckedThrough`, snapshot IDs, or D1
historical release metadata.

## Production safety findings

An immutable Vercel URL can return login HTML with HTTP 200. The alias workflow
now verifies project/team ownership and Ready production state through read-only
Vercel APIs, reuses an existing automation-bypass credential, and requires the
release API's exact deployment SHA. It does not create a bypass or disable
Deployment Protection. The public stable URL is verified without authentication.

The GitHub repository currently has `CLOUDFLARE_ACCOUNT_ID` and
`INGESTION_ADMIN_TOKEN`, but not `VERCEL_TOKEN` or the dedicated backup credential.
Code validation is not evidence that these unattended workflows have succeeded.
The operator-assisted production promotion does not satisfy an automation SLO.

## Backup and restore evidence

Both remote D1 data-only exports completed. Their local compressed copies passed
SHA-256 checks and full decompression. No SQL, snapshots, signed download URLs, or
credentials are included in this report or commit.

The standard isolated Wrangler restore failed before import with Windows
`workerd spawn UNKNOWN`. A separately labelled Node SQLite offline check then
applied 10 Catalog and 16 Pipeline migrations, imported the complete exports, and
ran the repository's verification scripts. Both databases had zero foreign-key
violations and `integrity_check=ok`; 14/80 triggers were restored and the Catalog
FTS count matched 3,931/3,931. The offline check took 5.30 seconds, which is not a
measured production RTO.

R2 upload was blocked by the execution safety review and was not retried through
another route. No remote checkpoint or R2 read-back was completed. Explicit
approval for uploading the two production exports to the private
`studyinchina-backups` bucket is pending. No backup/RPO SLO is claimed.

**Do not switch production to D1:** the restored Catalog active release is still
dated 2026-07-26 and contains 6 institutions, 1,006 programs, no admission cycles,
and 55 scholarships. It is not equivalent to the live JSON catalogue. A fresh
validated Pipeline release, full Shadow comparison, and rollback evidence remain
required before changing the production backend.

Private local reports are under
`.pipeline-build/manual-backup-2026-08-30/`; the untracked-asset inventory is
`.pipeline-build/untracked-assets-2026-08-30-release.json`. These are deliberately
excluded from Git. Candidate assets were not promoted by this maintenance work.
