# Durable third-party programme feed

The code checkout stays on `main`; the separate, pre-seeded orphan data branch is `catalog-program-feed`. The workflow runs every 15 minutes at minutes 3/18/33/48 only after `PROGRAM_CATALOG_HARVEST_ENABLED=true`. No desktop agent, Cloudflare account change, official verifier, protected official publisher, or new subscription is involved.

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

The runner passes only explicit collector environment keys (`RUNNER_TEMP`, `SICAS_RAW_DIR`, optional `MINIMAX_SUBSCRIPTION_KEY`); GitHub credentials are not passed into collector inputs or artifacts. Current collection is deterministic and makes no model calls. No matching MiniMax GitHub secret existed during the read-only audit, so an absent optional secret does not stop collection. Raw captures remain optional runner-temporary data and are not uploaded by this workflow.

Offline checks:

```sh
node --test scripts/ingestion/program-catalog-feed.test.mjs scripts/harvest/sicas-collector.test.mjs
```

Cloud entry point (requires the real separate data checkout):

```sh
node scripts/ingestion/harvest-program-catalog.mjs --execute --feed-dir ../feed --limit 150 --max-minutes 9
```
