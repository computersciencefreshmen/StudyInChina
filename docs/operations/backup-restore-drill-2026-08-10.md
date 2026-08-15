# D1 backup and isolated restore evidence — 2026-08-10

## Scope

This record documents the first end-to-end backup proof for both StudyInChina D1 databases. It is operational evidence, not a claim that scheduled backup SLOs are already met.

- Source databases: `studyinchina-catalog` and `studyinchina-pipeline`
- Private R2 bucket: `studyinchina-backups`
- Format: `raw-v1`
- Daily prefix: `backups/daily/2026-08-10/raw-v1/`
- Monthly prefix: `backups/monthly/2026-08/raw-v1/`
- Lifecycle: daily checkpoints expire after 35 days; monthly checkpoints expire after 370 days

The bucket has no public development URL or custom domain. The restore ran locally without Cloudflare credentials and could not write to either remote D1 database.

## Export and readback

| Database | SQL bytes | gzip bytes | SHA-256 |
|---|---:|---:|---|
| Catalog | 18,828,924 | 2,028,382 | `2bda279fc280697da2403e99f53ac22f52cb7db7601929e16febf92bdeb3d90f` |
| Pipeline | 21,529,431 | 2,873,901 | `0fa12ac2f94b1c86754b25efe593c0836a6ac054f234e179833bbd51a90ec4bc` |

All six daily and monthly objects were uploaded with `Content-Encoding: identity`, downloaded again, checked for the gzip magic header and verified against the stored checksum manifest. Both daily and monthly readbacks matched byte-for-byte.

This explicit encoding is required because an R2 object whose `.gz` content is labelled as encoded gzip can otherwise be transparently decompressed during download, which changes the bytes and invalidates disaster-recovery hashes.

## Isolated restore result

Status: **passed**
Mode: **local-isolated**
Elapsed time: **101.198 seconds**

| Database | Total restore | Bulk data import | Foreign-key violations | Integrity | Additional checks |
|---|---:|---:|---:|---|---|
| Catalog | 51.766 s | 1.259 s | 0 | `ok` | 14 triggers; FTS 3,931 / 3,931 |
| Pipeline | 49.376 s | 1.879 s | 0 | `ok` | 80 triggers; sources 100; jobs 231; snapshots 71; candidates 65 |

The Catalog verifier now compares restored entity counts with the active Release `counts_json`. It does not assume that every entity class must be non-zero; this matters because the current D1 Release legitimately reports zero program cycles. Institutions, programs and scholarships retain a non-zero safety gate.

The restored Catalog currently reflects the existing D1 Release rather than the newer Git JSON catalogue. Its active projection contains 6 institutions, 1,006 programs, 0 program cycles and 55 scholarships. This is useful recovery evidence, but it also confirms that Production must remain on the JSON backend until three Shadow Releases complete with zero critical differences.

## SLO interpretation

- The measured restore time is below the internal current-scale target of 60 minutes and the external RTO objective of 4 hours.
- One verified checkpoint does not satisfy the required 7/7 daily-backup streak or the 24-hour RPO over time.
- Scheduled GitHub backup and restore workflows remain fail-closed until the dedicated backup token, protected restore environment/token and Vercel alias token are configured through hidden repository settings.
- No Production Catalog pointer or public alias was changed during this exercise.
