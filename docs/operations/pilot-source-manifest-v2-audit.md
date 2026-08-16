# Pilot Source Manifest V2 migration audit

Audit date: 2026-08-10
Formal source check date retained from V1: 2026-07-20
Disposition: `in_progress` / fail-closed

## Outcome

The ten pilot institution manifests now use the institution-level
`SourceManifestV2` contract. This is a trust-ledger migration, not a claim that
the official catalogue has been fully reconciled.

| Institution | Preserved official sources | Pending reconciliation seeds |
|---|---:|---:|
| Fudan University | 10 | 2 |
| Harbin Institute of Technology | 9 | 5 |
| Nanjing University | 9 | 3 |
| Peking University | 12 | 9 |
| Shanghai Jiao Tong University | 9 | 1 |
| Sun Yat-sen University | 10 | 3 |
| Tsinghua University | 14 | 2 |
| University of Science and Technology of China | 11 | 3 |
| Wuhan University | 5 | 2 |
| Zhejiang University | 11 | 4 |
| **Total** | **100** | **34** |

The public trust ledger therefore reports:

- 10 formal V2 manifests in progress;
- 0 legacy V1 upgrade paths remaining in the pilot;
- 0 complete formal catalogue reconciliations;
- 0 publication-eligible pilot manifests.

## Locked migration invariants

The migration preserves each manifest's existing:

- institution ID and catalogue status;
- source IDs, official URLs, allowlists, schedules and extraction contracts;
- `enabled` and `robots` safety semantics;
- sixteen-category coverage ledger;
- 2026-07-20 source check date.

The nested fetch manifests intentionally remain V1 because that is the format
consumed by the ingestion Worker. V2 is the institution-level contract around
those sources.

`officialHosts` is the normalized union of the existing source and redirect
allowlists. No new fetch host was introduced.

## Reconciliation seeding policy

The 2026-08-10 disabled candidate cohort was used only as an audit index. A
catalogue identity was seeded into a formal manifest only when its candidate
source could be mapped to an existing pilot source by either:

1. the exact normalized official URL; or
2. the same official host and the same source category.

Every seeded item remains `pending`. Same-host mappings explicitly state that
exact page evidence is still missing. Candidate-only identities with neither
mapping were omitted instead of being guessed.

## Remaining gates

Before any pilot manifest can become `complete`, a reviewer must still:

- resolve all 34 pending identities with entity-level evidence;
- reconcile every official catalogue item to a terminal disposition;
- resolve 61 `discovery_pending` coverage categories;
- re-check the four `source_unavailable` categories where access permits;
- remove all audit-only markers and pending entries;
- pass the existing checksum-bound promotion review and full manifest
  validation.

Until then, `isCatalogReconciliationComplete()` remains false and the
promotion gate stays closed.
