# Official entity materializer

`scripts/ingestion/materialize-official-entities.ts` converts verified official
program or scholarship identities into idempotent business/evidence SQL plus a
content-addressed manifest. It accepts the JSON emitted by
`tsinghua-catalog-harvester.ts` directly and also accepts the
versioned generic envelope intended for additional university adapters such as
Zhejiang University.

The materializer materializes identity facts only. A catalog year, deadline, or
other cycle hint in the input is counted in the manifest but never creates a
`program_cycle`, `scholarship_cycle`, application route, or application window.
Those records require their own current official evidence.

The materializer is not an import control plane. Its SQL does not write
`materialization_batches`, `materialization_batch_record_intents`,
`materialization_batch_records`, `materialization_batch_chunks`, or
`materialization_batch_source_artifacts`, and it does not change
`records.workflow_status`. The manifest only declares the record mappings,
source artifacts, counts, hashes, and prerequisites that the strict importer
must reserve and verify.

## Prerequisites

The materializer never invents or promotes universities, cities, or scholarship
providers. Its manifest lists `prerequisiteInstitutionIds` and
`prerequisiteProviderOrganizationIds`, plus `prerequisiteLocationIds` and typed
`dependencyRecords` for handoff. The generated catalog-entity SQL starts with
fail-fast guards verifying the owner rows already exist in
`institutions`/`organizations`; it does not insert or promote dependencies.
Run the stable identity bootstrap and the separate dependency canonicalizer
before importing the catalog-entity batch.

## Accepted input

Existing Tsinghua harvest output is accepted without a wrapper:

```json
{
  "checkedAt": "2026-07-23T10:00:00.000Z",
  "entities": [
    {
      "entityType": "program",
      "entityKey": "tsinghua:master:024:081200",
      "institutionId": "uni-tsinghua-university",
      "programType": "degree",
      "degreeLevel": "master",
      "nameEn": "Computer Science and Technology",
      "nameZh": "计算机科学与技术",
      "officialUrl": "https://yzbm.tsinghua.edu.cn/publish/s05/s0503/detail/2807549e-b29c-43a9-9be9-755383c88eb5/1",
      "sourceCheckedAt": "2026-07-23T10:00:00.000Z",
      "evidence": {
        "locator": "json:datas.zsmlYxs[zsyxsdm=024].exportZsmlYxZys[zszydm=081200]",
        "quote": "081200 Computer Science and Technology",
        "officialUrl": "https://yzbm.tsinghua.edu.cn/publish/s05/s0503/detail/2807549e-b29c-43a9-9be9-755383c88eb5/1",
        "checkedAt": "2026-07-23T10:00:00.000Z"
      }
    }
  ]
}
```

Other adapters should emit the versioned generic envelope. Every owner must
already have an official-host boundary in the central owner registry. Optional
`source.officialHosts` values are assertions to check against that registry,
not authority to add a host: every declared value must be within the owner's
registered boundary, and an unknown owner fails closed even if it self-declares
a domain. Entity and evidence URLs are validated against the central boundary.
An evidence item may optionally list `fieldPaths`; when present, it is used only
for those fields.

```json
{
  "format": "studyinchina.official-entities",
  "formatVersion": 1,
  "checkedAt": "2026-07-23T11:00:00.000Z",
  "source": {
    "title": "Official catalog",
    "publisher": "University",
    "reviewedBy": "official-catalog-automation",
    "languageCode": "en",
    "officialHosts": ["example.edu.cn"]
  },
  "entities": []
}
```

Program identities require `localized.name`, `official_url`, `program_type`,
and a `degree_level` for degree programs. Scholarships require a provider,
scheme type, localized name, and official URL. Every accepted canonical field
is connected to a `primary_official` source fragment.

## Business/evidence SQL and freshness

For each fact, the generated business/evidence SQL performs these operations
in this order:

1. verify prerequisite owners and registered source boundaries;
2. write the entity identity, subtype, localized name, official source,
   successful fetch, and source fragment;
3. insert the claim as `candidate` and attach primary official evidence;
4. transition the claim `candidate → validated → accepted`;
5. write `canonical_fields` only after acceptance;
6. fail closed unless the complete canonical set is internally consistent.

The strict importer is the only component allowed to manage the batch lifecycle.
It first validates the package's immutable artifact bindings, creates the batch
reservation, and pre-registers every record intent. Only after the reservation
is complete does it move the batch to `importing` and execute the materializer's
business/evidence SQL. It then persists typed mappings and artifact rows,
verifies chunks, provenance, counts, canonical fields, evidence, and zero cycles,
and performs one atomic transition that makes the validated records and batch
`applied`. A materializer output by itself is never publishable.

`review_after` is the UTC calendar date of `checkedAt` plus 30 days. Stable
record, source, fetch, fragment, claim, public, and slug identities are derived
from SHA-256 inputs, making the SQL safe to execute repeatedly.

## Generate artifacts

```powershell
npx tsx scripts/ingestion/materialize-official-entities.ts `
  --input .pipeline-build/tsinghua-master-2026.json `
  --output .pipeline-build/materialized
```

The command writes a content-addressed business/evidence SQL file and a
declarative manifest with
`batchPurpose: "catalog_entities"`, `batchId`, `materializerVersion`, exact
counts (including `organizations: 0` and `locations: 0`), one typed
`recordMappings` entry per output record, prerequisites, ignored cycle hints,
source-artifact bindings, and the SQL SHA-256 digest. It does not create or
update batch-control rows.

## Complete provenance

For an importable batch, pass the orchestrator's provenance manifest:

```powershell
npx tsx scripts/ingestion/materialize-official-entities.ts `
  --input-directory .pipeline-build/priority-official-harvest/entities `
  --provenance-manifest .pipeline-build/priority-official-harvest/provenance-manifest.json `
  --output .pipeline-build/materialized
```

Its `sourceArtifacts` array supplies one artifact for every source document:
`sourceId`, `fetchId`, `localPath`, `artifactSha256`, private
`r2://studyinchina-source-snapshots/...` URI, `contentType`, `byteLength`,
`capturedAt`, and `isFixture`. The materializer reads the local bytes, verifies
their length and SHA-256, and writes `captureMode` (`live` or `fixture`) to the
output manifest. `capturedAt` is also the successful fetch completion time.

`provenanceStatus` is `complete` only when the artifact set exactly covers all
and only sources used by accepted primary evidence and none is a fixture.
Without an artifact, the corresponding fetch remains `queued` with no invented
HTTP status, completion time, digest, or artifact URI. Such a batch remains
useful for local inspection but cannot pass the remote importer.

The orchestrator may include artifacts with `role: "dependency"` for the
separate dependency canonicalizer. This catalog-entity materializer excludes
those artifacts from its batch and requires exact coverage from the remaining
catalog source artifacts.

## Direct harvester inputs

The materializer also accepts the raw output of the ZJU PDF harvester when
`parserVersion` is `zju-pdf-tsv-v1`. It validates the same Zhejiang University
HTTPS host boundary as the harvester, checks that every verified entity agrees
with the root catalog dimensions, and requires the evidence locator to match
its page, line range, and bounding box exactly. Evidence is stored as
`pdf_region`. `instructionLanguage: English` writes an `en` name; `Chinese`
writes a `zh` name. Duration and tuition remain evidence context and are not
materialized as identity facts.

Raw `ScholarshipIndexHarvest` output is accepted without a generic wrapper.
Each `institutionId` becomes the scholarship `providerOrganizationId`. Scheme
mapping is deliberately conservative:

- `government` becomes `government`;
- `university` becomes `university`;
- `language`, `donation`, `exchange`, `program_specific`, and `other` become
  `other`.

The PKU, ZJU, Fudan, Tsinghua, SJTU, and USTC URL checks use the official-host
boundaries in the central owner registry (populated from the validated pilot
and scholarship registries). An input cannot expand those boundaries.
Scholarship cycles, coverage, fee, deadline, duration, and tuition records are
never inferred by these adapters.

## Batch inputs

Repeat `--input` to materialize several harvests in one deterministic release:

```powershell
npx tsx scripts/ingestion/materialize-official-entities.ts `
  --input .pipeline-build/zju-master-english.json `
  --input .pipeline-build/zju-master-chinese.json `
  --input .pipeline-build/zju-doctorate-english.json `
  --output .pipeline-build/materialized
```

Or point to one directory. Immediate `.json` files are read in stable filename
order:

```powershell
npx tsx scripts/ingestion/materialize-official-entities.ts `
  --input-directory .pipeline-build/zju-six-pdfs `
  --output .pipeline-build/materialized
```

The two input modes are mutually exclusive. Exact duplicate identities are
deduplicated. The command fails closed when the same `entityKey` maps to another
owner or when duplicate identities disagree on facts or evidence. The manifest
records every resolved path in `inputPaths`; the legacy `inputPath` field is
also retained for a single input.

## PKU master Chinese directory harvest

Raw `pku-pdf-directory-v1` output is accepted for the verified Chinese-taught
master catalog only. The adapter requires `uni-peking-university`, `degree`,
`master`, and the registered `admission.pku.edu.cn` HTTPS catalog host. Every
entity key is recomputed from the official department and `programCode`; a key,
department, or code mismatch fails closed. Current page/line/code locators are
stored as `pdf_page` evidence.

`catalog_prefix_mismatch` quarantine records remain audit input only and are
never materialized. In particular, bachelor/doctoral-prefixed PDFs cannot enter
the master catalog. Catalog years, application dates, tuition, fees, and other
cycle facts are not created by this identity adapter.

Local full-catalog smoke command:

```powershell
npx tsx scripts/ingestion/materialize-official-entities.ts `
  --input .pipeline-build/pku-discovery/masters-cn-harvest.json `
  --output .pipeline-build/materialized
```

When the ignored discovery artifact is present,
`tests/unit/official-entity-pku-input.test.ts` additionally applies all 177
records twice to a migrated in-memory Pipeline database and checks foreign keys
and integrity. A compact checked-in real-shape fixture keeps CI independent of
the ignored artifact.

## SQL transport safety

All canonical guards remain inside the business/evidence payload. No batch
reservation, record intent, artifact binding, chunk marker, or workflow-status
transition is emitted by the materializer; the strict importer wraps the
payload with those controls. Generation fails if any emitted SQL unit reaches
20,000 UTF-8 bytes. `sqlStatements` and `maxSqlStatementBytes` in the manifest
expose the bound for deployment checks.
