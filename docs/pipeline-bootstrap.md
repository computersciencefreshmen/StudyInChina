# Pipeline bootstrap import

The Pipeline D1 bootstrap creates the stable identities and official-source
bindings required before automatic extraction can promote any fact. It is
generated from the validated files in `content/data` and the ten pilot Source
Manifests.

## What it imports

- the 12 verified cities as `location` records;
- the 39 verified universities as `organization` plus `institution` records;
- stable slugs, official domains, and localized identity content;
- all official source documents from `content/data/sources.json` and the pilot
  manifests, deduplicated by canonical URL;
- publication source titles and publishers;
- all 100 ingestion manifests and enabled bindings for the 86 sources that
  currently pass robots and parser readiness checks;
- canonical field definitions with explicit risk and freshness policies.

The bootstrap intentionally imports no `program` rows. In particular, the 112
draft program templates in `content/data/programs.json` are not promoted or
copied into Pipeline. It also creates no field mapping for aggregate extraction
facts such as `programs`, `scholarships`, or `guide`. Those facts remain
fail-closed until a versioned identity-discovery extractor emits record-level
candidates. This prevents a directory page from being attached to one arbitrary
template program.

## Build and inspect

From the repository root:

```powershell
npm run pipeline:build-bootstrap
Get-Content .pipeline-build\pipeline-bootstrap.manifest.json
```

The generated SQL is idempotent. Rebuilding it with a later timestamp does not
reset fetch state, row versions, applied/published workflow status, or unchanged
update timestamps. If a managed manifest source is removed or disabled, its
ingestion source and publisher binding are disabled; historical source rows are
retained for evidence integrity.

## Import

Apply migrations and import into local D1:

```powershell
.\scripts\ingestion\import-pipeline-bootstrap.ps1
```

Import into the configured remote Pipeline D1:

```powershell
.\scripts\ingestion\import-pipeline-bootstrap.ps1 -Remote
```

The wrapper rebuilds the artifact, applies all Pipeline migrations, executes
the SQL, and prints the resulting identity/source counts. It never reads or
prints Cloudflare or MiniMax secrets.

## Safety boundary

Bootstrap records start as `validated`, not `applied` or `published`. A record
can enter a Catalog release only after the publisher writes accepted canonical
fields with official evidence and current freshness metadata. Existing
`applied`, `published`, quarantined, archived, or rejected states are preserved
on repeated imports.
