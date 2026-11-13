# Temporary account-to-account R2 copy

This tool copies the fixed `snapshots`, `releases`, and `backups` bucket bindings.
It has no D1, model, production-secret, queue, cron, delete, or arbitrary-source API.
All endpoints, including health, require a new 64-hex `MIGRATION_TRANSFER_TOKEN`
and the same `x-migration-id`. Do not reuse a production token.

Before freezing, authenticated `GET /v1/inventory?bucket=snapshots` (or `releases`
or `backups`, with the returned `cursor` for later pages) provides the same bounded
descriptors and metadata as listing. It reports the actual `sourceFrozen` flag
and always `cutoverReady=false`: it is a preflight inventory, not a consistent
snapshot or copy admission. Sum the listed sizes to locate objects above 16 MiB.
`/v1/list` and `/v1/object` still require `SOURCE_FROZEN=true`; passing inventory
descriptors to the target cannot bypass the source byte-read freeze gate.

1. Freeze all source writers and record the freeze proof. Keep destination
   production workers/queues/models disabled throughout migration and validation.
2. Make two private copies of `wrangler.example.jsonc`, explicitly pinning each
   account, profile and bucket binding. Set source role `source` and
   `SOURCE_FROZEN=true` only after the freeze. Set target role `target`, with
   `SOURCE_URL` and the exact matching `SOURCE_HOST` fixed to the source Worker.
   Public workers.dev exposure is off in the example; enable an authenticated
   reachable hostname deliberately. Never use production Worker configs here.
   If the private config is stored elsewhere (for example under `.tmp`), resolve
   `main` to this tool's absolute `workers/account-migration/src/main.ts` path;
   Wrangler resolves relative entrypoints from the config file's directory.
3. Generate a new random 32-byte token through the approved secret mechanism,
   install it on both temporary Workers with hidden Wrangler secret prompts,
   and supply it to the driver process environment. Never print it or pass it
   on the command line. OAuth profiles authorize deployment; S3 keys are not used.
4. Supply `MIGRATION_ID`, `MIGRATION_SOURCE_URL`, `MIGRATION_TARGET_URL`, and
   `MIGRATION_TRANSFER_TOKEN` in the driver environment. Run:

   ```text
   node --import tsx scripts/cloudflare/copy-account-r2.ts --manifest .tmp/account-r2-private.json --max-pages 1
   ```

   Re-run the same command with a larger bounded `--max-pages` to continue.
   `--bucket snapshots|releases|backups` narrows the explicit manifest scope.
   Finish with `--verify`, which re-reads both source and destination for all
   recorded objects. The checkpoint is private and checksum-bound to the two
   endpoints and migration ID; do not publish it as a CI artifact.

Every list/copy batch has at most four objects. Objects up to 16 MiB are processed
sequentially with bounded binary buffers and Web Crypto SHA-256. Larger objects
are explicit holds with no invented digest and require a separately audited
large-object transfer. Held/error entries prevent `complete=true` and are retried
on resume. Exit code 2 means incomplete; code 1 means a failed request/checkpoint.

Copies preserve exact HTTP metadata, Unicode/custom metadata and original raw
bytes. The transport never sets the original content encoding, avoiding automatic
gzip decompression. ETags are not treated as content hashes. Existing target
objects must have the same size, SHA-256 and metadata; conflicts are held and never
overwritten. Conditional creation also protects races with other writers.

Per-object receipts live under
`__studyinchina_account_migration/<migration-id>/` in the target snapshots bucket.
Only that same migration's tool-receipt prefix is explicitly excluded from source
pagination and reported separately. No real business/evidence/budget prefix is
filtered. A local page cursor advances only after its copy results are durable.

The tool leaves historical budget policies and quota waits frozen and intact.
Rebinding those controls, copying Durable Object reservations, validating D1, and
activating production remain separate gates. R2 copy completion alone never
authorizes a model call. Keep the source available for rollback and remove the
temporary endpoints/transfer secret through the normal reviewed cleanup after
the account cutover is accepted.

Local canary (no real Cloudflare/provider access):

```text
node --import tsx --test workers/account-migration/tests/runtime.test.ts
```

The canary uses actual workerd fetch and six native Miniflare R2 buckets; every
outbound request is intercepted and only the fixed source is permitted.
