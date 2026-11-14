# Cloud MiniMax monitoring in the existing administrator dashboard

The existing telemetry route carries sanitized uploads from a desktop executor.
It cannot establish current cloud activity after that computer stops. Keep those
historical receipts separate and add an optional `cloudMiniMax` snapshot to the
existing authenticated administrator status, overview and usage views.

Data flows from the browser's existing administrator session through the Next.js
server to the catalog API's private GET `/internal/v1/admin-minimax-monitor`.
This uses the existing server-side `ADMIN_TELEMETRY_TOKEN` and URL configuration;
no new MiniMax key or maintenance administrator credential reaches Vercel or the
browser. Missing bindings fail closed for this panel; other admin capabilities
retain their existing behavior. Responses are private, no-store, strict schemas.

The catalog API reads the real pipeline D1 ledger through a new `PIPELINE_DB`
binding. Indexed, bounded queries aggregate original `started_at` in Shanghai
today, the current provider windows and the last seven days. These overlapping
windows are never added together. Old imported calls retain their original
timestamps. M3, the actual M3.1-Flash identifier and historical Preview identifiers
remain distinguishable. SQL returns only counts, numeric usage and safe statuses;
prompts, model outputs, raw response references, account details and credentials
are excluded. Input and cache values preserve the provider's reported semantics.
Missing usage is null, and partially reported totals are labelled lower bounds.

Quota comes from a same-account named `MaintenanceMonitor` RPC entrypoint on the
maintenance Worker. It exposes one no-argument `readQuota()` capability, using the
existing official read-only quota client. The regular admission path remains
unchanged and continues obtaining its own fresh quota; monitoring cannot admit,
retry or start model work. A frozen source role performs no provider reads.

The native RPC import is isolated in `src/entry.ts` and `quota-monitor.ts`.
Wrangler deploys that wrapper, re-exporting the existing default handler and
Durable Object class. Node tests can continue importing the ordinary handler
without replacing the production RPC runtime with a shim. Real double-Worker
workerd tests exercise named RPC, actual global fetch interception, auth and
concurrent request coalescing, with no real provider calls.

Each cloud layer coalesces in-flight reads and caches for 45 seconds per isolate;
failures retry after 15 seconds and preserve original observation timestamps with
stale labels. These are monitoring caches, not account-wide admission locks.
The existing administrator transport continues delivering snapshots; cloud data
refreshes independently of uploaded desktop observations. Expired provider
windows cannot be displayed as current available quota. Weekly infinity is
explicitly separate from a finite five-hour quota. The quota endpoint supplies
neither monetary billing nor an actual credit balance, so neither is invented.

Coverage uses the current scope/catalog-bound content-addressed snapshot from
`SOURCE_SNAPSHOTS`, verifying checksum and the exact current school ID set. It
reports the existing strict five-concrete-programme measurement; missing or
outdated coverage remains visibly unavailable or stale. A school count by itself
does not establish coverage.

Deployment integration (operator, after exact-tree CI): apply pipeline migration
`0024_cloud_monitor_indexes.sql`; deploy maintenance with `main: src/entry.ts`
while preserving all live variables/resources; then add the catalog API's
`PIPELINE_DB` target database, read-only-use `SOURCE_SNAPSHOTS` bucket and named
`MAINTENANCE_MONITOR` service binding before deploying it. Preserve all existing
live values and secrets. The source defaults pin the existing Gmail account and
target resource IDs. No deployment, secret changes or model calls are part of
the implementation task. No additional paid service is introduced.

The existing offline migration-config builder now recognizes only this exact
reviewed service/entrypoint pair. Its live metadata must match, with no alternate
environment, arbitrary RPC props or cross-account grant. Other service bindings
still require an explicit review; all original resource checks remain enforced.

RPC references:
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
- https://developers.cloudflare.com/workers/runtime-apis/rpc/
