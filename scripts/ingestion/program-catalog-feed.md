# Durable third-party programme feed

The code checkout is pinned to the workflow commit on `main`. The separate data branch is `catalog-program-feed`. The cloud workflow runs every 15 minutes at minutes 3/18/33/48 when `PROGRAM_CATALOG_HARVEST_ENABLED=true`. Its read-only collection job archives the exact bytes of each successful SICAS detail response before extraction. The short publication job checks out the current feed, validates the candidate and publishes once. Both producers share the atomic Git fast-forward writer. Concurrent translation-only and harvest-only changes can be rebased; overlapping paths halt publication.

Root must seed the data branch with `vercel.json` containing `{"git":{"deploymentEnabled":false}}` before enabling the workflow. The checkpoint preflight requires this file, the exact data branch, and the expected GitHub origin; it never changes deployment settings on `main`. The data branch must contain no application source or credentials.

From the code checkout, after root creates the separate orphan `catalog-program-feed` checkout:

```sh
node scripts/ingestion/seed-program-catalog-feed.mjs --execute --feed-dir ../SIC-program-feed-data
```

The seed command checks the destination branch before writing, refuses to overwrite an existing feed, writes the data-only Vercel deployment-disable marker, imports the current static directory plus captured details, and verifies all generated hashes. It does not commit, push, enable the workflow, or change the code checkout. Root commits/pushes the seed separately, then enables the guarded schedule.

`writeProgramFeed(feedDirectory, {records,state,receipts,generatedAt})` writes:

- `manifest.json`: `schemaVersion:1`, `revision`, `generatedAt`, `official:false`, `counts` with `programCount/capturedCount/schoolCount/sourceCount`, `indexShards`, and the `state` descriptor.
- `indexes/<sha256>.json`: `{schemaVersion:1,programs:[...]}`, at most 500 records and 900,000 bytes. Each record contains ThirdPartyProgram basic fields and `detail:{path,sha256,bytes}` or `null` for URL-only discoveries.
- `details/<hash-prefix>/<sha256>.json`: a complete sanitized programme record, at most 5,000,000 bytes. Captured dates are literal source claims, `official:false` and `admissionYear:null`. Full fields and exact `fieldEvidence` are retained; missing facts stay absent.
- `state/progress.json`: the collector's sanitized durable cursor, per-ID outcomes, and provider backoff. It may exceed the Next cache limit because only the cloud collector reads it; it is capped at 8 MB.
- `receipts/<sha256>.json`: sanitized public source URLs, method/status/time/bytes/raw SHA, and fixed error codes. No response headers, cookies, credentials, raw HTML, private paths, or model payloads are committed.

Existing published CUCAS records can be seeded with their source body hash and current public fields even when their old public projection omitted section quotes. New collector records must bind every returned field to a literal `fieldEvidence` quote before merging; the legacy compatibility rule does not authorize new unquoted fields.

All descriptor hashes cover exact UTF-8 file bytes, including the final newline. `revision` is SHA-256 of canonical JSON of `{schemaVersion:1,counts,indexShards}`. Canonical JSON sorts object keys recursively, preserves array order, and omits undefined object properties. Progress-only changes therefore retain the content revision while remaining durable Git commits. Index and detail files are immutable; later versions receive new content-hash paths.

`loadProgramFeed()` verifies descriptors, hashes, bounds, counts, unique identities, and detail-to-index identity before trusting a checkpoint. The collector boundary is `collectSicasBatch({sources,state,limit,deadlineAt,environment}) -> {records,state,receipts,summary}`. One run collects at most 250 requests and runs for at most nine minutes by default, then validates, commits, and pushes that batch before finishing. A failed push fails the run; it never force-pushes or starts another batch. The next cloud run resumes from the last successfully pushed state. HTTP 403/429 backoff is committed even if no details were captured.

The deterministic collector receives an archive callback. The callback uses the configured target maintenance Worker and the existing Actions maintenance credential, checks the returned URL, byte count and SHA-256, and releases the page for parsing only after receipt. R2 stores immutable bytes under `maintenance/provider-evidence/sicas/<first-two>/<sha256>.bin`. An authenticated reviewer can look them up via the existing artifacts route. An `archiveSha256` matching the observation digest identifies confirmed private storage. Legacy hashes alone provide no such confirmation. An archive error defers the item for retry, checkpoints the remaining progress and surfaces a failed health signal.

The same service returns the official scheduler's version-bound daily coverage snapshot. The collector matches unique exact institutional names, prioritizes schools with 0, 1, 2–4 and 5+ complete majors, and rotates by least-recent attempt within each band. Ambiguous identities remain discovery work. When no current snapshot is available, discovery uses its existing round robin and records a null coverage hash. The schedule state records both coverage hash and input feed revision. Provider observations never promote a university's official coverage count.

A newer sparse observation can reuse a quoted field from the same dated offering with the original evidence URL, digest and date. Explicitly different cohorts/tracks stay separate in history. Without adequate scope evidence the existing projection stays dated to its previous capture and the incoming observation is queued for review. The publication job checks the candidate's input state hash, merges on top of current records, and recognizes an exact already-applied batch. A conflicting harvest cursor requires a new observation; it cannot be force-pushed.

Offline checks:

```sh
node --test scripts/ingestion/program-catalog-feed.test.mjs scripts/harvest/sicas-collector.test.mjs
```

Cloud entry point (requires the real separate data checkout):

```sh
node scripts/ingestion/harvest-program-catalog.mjs --execute --feed-dir ../feed --limit 150 --max-minutes 9
```
