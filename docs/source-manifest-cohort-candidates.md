# Source Manifest cohort candidate workflow

## Purpose

This workflow turns the locked Ministry of Education Double First-Class target
registry, the current catalog JSON, and the validated official reconciliation
registry into a review queue for `SourceManifestV2`. It does not discover new
URLs, fetch websites, or publish manifests.

The separation is intentional:

`official target registry + exact catalog relationships + validated reconciliation fallback -> candidate artifact -> evidence review -> formal manifest`

The generator excludes the three military institutions, accepts only exact
catalog relationships to sources already marked official and using HTTPS, and
never fuzzy-matches a university or invents a missing source.

The reconciliation registry is used only when a school has no safe program or
scholarship catalog source. Matching uses the exact official Chinese name. A
verified category becomes parser-pending; `source_unavailable` and
`officially_not_provided` remain distinct. Each fallback is disabled,
robots-blocked, scoped as `limited_official_catalog`, and contains a synthetic
pending institution-level audit entry that is explicitly not a publishable
program.

## Local use

Inspect current coverage without writing:

```powershell
npm run pipeline:build-source-manifest-candidates -- --checked-at 2026-08-06 --dry-run
```

Create a new candidate artifact in an explicit empty directory:

```powershell
npm run pipeline:build-source-manifest-candidates -- --checked-at 2026-08-06 --artifact-output C:\tmp\source-manifest-candidates
```

Verify a downloaded or locally generated artifact:

```powershell
npm run pipeline:verify-source-manifest-candidates -- C:\tmp\source-manifest-candidates
```

The write command refuses a destination inside `content/source-manifests`, a
symbolic-link destination, and any non-empty destination. This prevents a stale
candidate from being mixed into a new run or mistaken for a production
manifest.

## Artifact contract

Every bundle contains:

- `manifests/*.v2.candidate.json`: disabled, review-only candidates;
- `gap-report.v1.json`: per-institution missing mappings, rejected sources,
  and uncovered source categories;
- `artifact-manifest.v1.json`: exact SHA-256 and byte length for the six locked
  catalog inputs, every `content/source-registry/reconciliation/*.v1.json`
  input, and every generated JSON file;
- `SHA256SUMS`: independent checksums for the artifact manifest, gap report,
  and every candidate.

Verification rejects added, missing, changed, duplicated, or unsafe paths. It
also reparses every candidate through the V2 schema and confirms that every
source remains disabled, robots-blocked, and pending review.

## GitHub workflow

`Build Source Manifest Candidate Cohort` is a manual, read-only workflow. The
operator supplies an explicit evidence check date. It builds only under
`runner.temp`, validates the official target and reconciliation registries,
and validates relevant current-catalog relationships while building each
disabled candidate.
It then verifies the completed bundle, proves that
`content/source-manifests` did not change, and uploads the result as a
short-lived review artifact.

Promotion remains a separate evidence-review action. Candidate artifacts must
never be copied wholesale into the formal manifest directory.
