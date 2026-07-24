# Priority official catalog harvest

`scripts/ingestion/run-priority-official-harvest.ts` is the unattended, deterministic
harvest entry point for the first high-volume official program and scholarship sources.
It does not call an AI service. The existing school-specific harvesters remain the
parsers of record.

## Registered required sources

Every URL is an explicit configuration value and must use HTTPS on an exact registered
host. The orchestrator never guesses a new annual URL.

- Tsinghua University: the registered master and doctorate catalogue pages plus their
  official `yzbm.tsinghua.edu.cn` department query endpoint. Their audited 2026
  verified baselines are exactly `99` and `118` programs.
- Zhejiang University: six fixed 2026 official PDFs: bachelor, master, and doctorate,
  each in Chinese and English. Their audited verified baselines are respectively
  `80`, `4`, `209`, `59`, `174`, and `86` programs (`612` total).
- Peking University: the 2026 Chinese-taught international master index at
  `admission.pku.edu.cn`. The index exposes 37 PDF anchors. Exactly 36 match the
  master/Chinese directory contract; the `00039` type-mismatch link is quarantined
  and is not downloaded as a valid catalogue document.
  The 36 accepted PDFs must reconcile to exactly `177` deduplicated programs.
- Scholarship indexes: all registered official index pages from Peking University,
  Zhejiang University, Fudan University, Tsinghua University, Shanghai Jiao Tong
  University, and the University of Science and Technology of China.
- Dependency pages: six official English university home pages for Tsinghua, Peking,
  Zhejiang, Fudan, Shanghai Jiao Tong, and USTC; the official English Beijing,
  Shanghai, and Hangzhou government pages; and USTC's official Hefei/About page.
  These ten pages are captured as `role: dependency` and
  `batchScope: dependency`. They are required sources, but they are never included
  in the catalog materializer's `sourceArtifacts` batch because they do not directly
  evidence any of the 1,006 programs or 55 scholarships.

The annual rollover procedure is to audit the new official pages and update the
configuration constants and their tests in one reviewed change. Redirects are accepted
only when every hop remains on the source-specific host allowlist.

## Collection policy

The run is intentionally conservative:

- all requests are serial;
- request start times on the same host are at least five seconds apart;
- `robots.txt` is enforced and cached for direct downloads; the scholarship harvester
  retains its own robots decision as an additional check;
- retryable HTTP statuses and transport errors receive up to three attempts by default;
- no login, CAPTCHA, `403`, access control, or region restriction is bypassed;
- HTML is bounded to 10 MiB and PDFs to 80 MiB;
- a downloaded PDF must have a PDF file signature;
- no MiniMax or other AI API is used.

## Running locally

Poppler's `pdftotext` must be installed before the run.

```bash
npx tsx scripts/ingestion/run-priority-official-harvest.ts \
  --output .official-harvest \
  --state-file .harvest-state/source-hashes.json \
  --delay-ms 5000 \
  --max-attempts 3 \
  --pdftotext pdftotext
```

Useful optional arguments are `--checked-at <ISO timestamp>` for a reproducible source
check time and `--output <directory>` for an isolated run root. The orchestrator refuses
to clear a filesystem root or the repository root.

## Output contract

The output directory is rebuilt for every run:

```text
.official-harvest/
  raw/
    tsinghua/*.html
    zju/*.pdf
    pku/*.html and *.pdf
    scholarships/*.html
    dependencies/*.html
  harvests/
    *.json
  run-manifest.json
```

`harvests/` contains only inputs accepted by
`materialize-official-entities.ts`. Keeping `run-manifest.json` outside that directory
prevents the materializer from treating operational metadata as an entity harvest.

Each raw asset has a SHA-256 value in `run-manifest.json`. The state file stores the
prior hash by stable asset ID. A matching hash is reported as `unchanged`, but the
asset is still saved and parsed; unchanged content never skips reconciliation.
Multi-document sources report `mixed` when only some assets changed.

The machine-readable run manifest contains:

- source URL and exact source status (`verified`, `quarantined`, or `failed`);
- raw asset paths, final URLs, hashes, byte lengths, and change status;
- verified and quarantined counts per source;
- harvest JSON paths and bounded error descriptions;
- total projects and deduplicated scholarships;
- the policy settings and final gate reasons;
- `aiUsed: false`.

The top-level `sourceArtifacts` array is the catalog provenance batch. It contains
only the exact 54 live, non-fixture objects used as primary evidence by the catalog
materializer: two Tsinghua source bundles, six Zhejiang PDFs, 36 Peking PDFs, and
10 scholarship index pages. Every entry includes the private deterministic R2 URI,
SHA-256, byte length, HTTP status, final URL, `capturedAt`, and `checkedAt`.
The separate `dependencyArtifacts` array contains exactly ten school/city pages with
their own hashes, byte lengths, capture times, and deterministic R2 keys. Keeping the
two batches separate prevents the strict materializer from accepting unused evidence.

The Peking international-student scholarship overview is captured, parsed, and retained
in the source run's raw assets and dated recovery archive, but it contributes no final
unique scholarship after deterministic cross-page deduplication. It is therefore
intentionally absent from the 10-page catalog provenance subset because the strict
importer rejects unused primary evidence.

Per-object R2 keys use
`source-artifacts/<sha256(assetId)[0:24]>/<contentSha256>.<extension>`. Unchanged bytes
for the same stable asset reuse one object across weekly runs, while identical bytes
from two different assets retain distinct namespaces. Dated keys are reserved for the
additional recovery archive, checksum, and run manifest.

## Fail-closed gates

The CLI writes the manifest before applying its exit gate. It exits nonzero when any of
the following is true:

- verified projects are below `1006`;
- deduplicated verified scholarships are below `55`;
- catalog provenance contains anything other than exactly `54` source artifacts;
- any of the ten required dependency pages fails capture or HTML validation;
- any individual Tsinghua, Zhejiang, or Peking 2026 source differs from its audited
  verified count, even if the combined project total still reaches `1006`;
- any required source is not `verified`;
- the PKU index does not reconcile to 36 accepted documents and one quarantined
  mismatch, or any accepted PDF is missing/quarantined.

A source can contain row-level quarantines while remaining verified when its required
source-level reconciliation succeeds. The quarantined count remains visible in the
manifest and in the school harvester JSON.

## GitHub Actions and Pipeline D1

`.github/workflows/official-catalog-harvest.yml` runs every week, on the first day of
each month, and on manual dispatch. It uses Ubuntu, Node.js 24, `npm ci`, and
`poppler-utils`. A private repository workflow artifact retains the raw evidence,
harvest JSON, materialized SQL when applicable, and run manifest for 35 days. A GitHub
Actions cache carries only the content-hash state between runs.

After all harvest gates pass:

- if both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets exist,
  the workflow validates the passed run manifest and every catalog/dependency local
  file before upload. It uploads each object to the exact private
  `studyinchina-source-snapshots/<r2Key>` location referenced by the manifest. Existing
  objects are reused only after their bytes and hash match; only a definitive missing-key
  response permits a new upload, and an existing mismatch is never overwritten. It then
  downloads each object again and verifies both SHA-256 and byte length. Any missing, changed, unsafe,
  fixture, wrongly scoped, or unreadable object fails the run;
- after per-object verification, it also builds a reproducible `tar.gz` containing
  `raw/`, `harvests/`, and `run-manifest.json`, then uploads the archive, checksum,
  and manifest as operational recovery artifacts under
  `priority-harvests/<YYYY-MM-DD>/`;
- only after all private R2 checks succeed, the `ubuntu-latest` workflow first applies
  the idempotent Pipeline bootstrap, then calls the dependency materializer with
  `--remote-contract` and strictly imports the six
  organization plus four city/location prerequisites. Only after that batch succeeds
  does it call the catalog materializer with
  `--provenance-manifest run-manifest.json`. For both batches the strict importer
  validates and packages the materialization manifest, applies resumable chunk
  markers, verifies exact record/evidence/source counts and zero unused provenance,
  then performs the final atomic batch transition. It never executes an unverified
  materializer SQL file directly;
- only after both batches are `applied`, the workflow creates one idempotent,
  immutable materialization Release request tied to the two exact batch IDs. The
  request transaction creates the publication job and outbox event together. The
  scheduled Release Builder then builds the versioned Catalog artifact, validates
  it, and atomically advances the Catalog release pointer;
- otherwise it reports that Pipeline import was skipped and still preserves the harvest
  artifact.

The workflow never echoes credential values or creates a public R2 URL. A failed harvest
skips R2 and D1; a failed R2 upload blocks D1. The GitHub artifact upload runs with
`always()` so failure evidence remains available. Raw snapshots are operational
evidence and must not be published as public mirrors.
