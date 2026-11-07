# Fluid CPU cache implementation plan

**Goal:** Reuse strictly validated public catalogue work across independent requests without changing identity, receipt, publication or Shanghai date semantics.

**Architecture:** Instance-local immutable file snapshots track metadata for JSON, ledgers and every receipt dependency. Public projections use raw snapshot identity, evidence snapshot identities and China calendar date; revision serialization occurs only on a miss. Dynamic HTML and existing API CDN policy remain, with a midnight header guard. Non-JSON repositories keep their existing remote freshness contract.

**Tech stack:** Locked Next.js 16.4.3, React request memoization, Node filesystem/CPU APIs, Vitest. No new infrastructure.

1. Record current main/deployment state; isolate from the older dirty workspace. Capture identical-data baseline for page loader, directory API, release and repository lists; build and sample real HTML locally.
2. Introduce bounded dependency-aware synchronous file snapshots (strict evidence, retry failures, atomic generation check, recursively frozen values). Reuse parsed raw bundles across runtime consumers. No content hashing to find a cache key.
3. Cache public/current/directory projections and revision per immutable generation and Shanghai date; connect page, repository and API paths. Preserve preview/raw separation and remote modes.
4. Index per-projection program identities and official sources; reuse date formatter. Preserve all schema, hash, scope and expiration gates.
5. Limit remote release smoke to declared changes and sentinels; retain explicit full regression locally and full remote opt-in. Record evidence, not guessed run frequency.
6. Verify data/receipt updates, midnight/expiry, concurrent initialization, failures/recovery, mutation protection, languages and authentication isolation. Run typecheck, lint, required tests and production build; repeat identical benchmarks and HTML requests.
7. Report measured CPU versus wall time separately, unchanged output hashes, cold costs and instance limits. Model team budget with traffic mix, cold fraction and CDN uncertainty; do not claim production savings or service restoration.

**Cache invalidation:** Files deployed to Vercel are immutable for a deployment. In mutable local/admin execution, stat identity (real path, device/inode, size, nanosecond mtime/ctime) is checked on every access, including missing receipts. A changed dependency discards the old result; failures never serve stale evidence. Date changes replace the one retained public generation. A new deployment initializes independently.

**Tradeoff:** A small number of filesystem metadata reads per request replaces JSON parsing, schema checks, receipt hashing and full projection. This protects immediate file changes without TTL staleness. Each instance still pays initialization; HTML still invokes a function, so production route mix and cold-start frequency remain necessary to establish a 5–6 minute/day budget.
