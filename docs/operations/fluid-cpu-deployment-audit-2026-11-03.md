# Fluid CPU deployment and cache boundary audit — 2026-11-03

## Read-only deployment evidence

- GitHub `branches/main` returned `c93a6cad17df5fc006e9fef69976cd4e5d08e79a`, merged PR #75, at this audit. [Branch](https://github.com/computersciencefreshmen/StudyInChina/tree/main).
- The connected GitHub `get_commit_combined_status` tool returned `context: Vercel`, `state: success`, [deployment dashboard](https://vercel.com/henry-yangs-projects-c9706eac/studyinchina/FzFvLWEUYCoy2ToMcSbtoe8Xo9H9) for that exact commit. This is historical deployment status, not current service availability.
- [Production alias workflow 41317993520](https://github.com/computersciencefreshmen/StudyInChina/actions/runs/41317993520), created `2026-11-01T14:48:16Z`, completed `success` for that SHA. Connected GitHub `fetch_workflow_run_jobs` returned job `124882019329` with successful steps for exact-SHA CI, immutable deployment release API, durable release writer, and stable-alias promotion plus release API verification. These establish the last recorded successful promotion; they do not establish current serving SHA while disabled.
- Exactly one successful network observation was made against `https://studyinchina.vercel.app/api/v1/releases/current`. No load test or account mutation was performed. The response was:

```text
HTTP/1.1 402 Payment Required
Cache-Control: public, max-age=0, must-revalidate
Content-Length: 78
Content-Type: text/plain; charset=utf-8
Date: Tue, 03 Nov 2026 15:19:02 GMT
Server: Vercel
X-Vercel-Error: DEPLOYMENT_DISABLED
X-Vercel-Id: hkg1::hw6sb-1793719141781-57d663568700

Payment required

DEPLOYMENT_DISABLED
```

The observation corresponds to **2026-11-03 23:19:02 Asia/Shanghai**. The stable production alias is currently disabled. The release payload is unavailable, so its current serving SHA cannot be independently read back. This response does not identify the billing cause or confirm account usage figures. The user's dashboard figures remain user-provided evidence, not independently measured numbers in this audit. Neither the 402 nor low/zero usage during suspension demonstrates performance improvement.

## Rendering and caching architecture review

At the audited baseline:

1. `src/app/[locale]/layout.tsx` awaits `connection()` before loading the public catalog. This affects localized pages beneath the layout, including pages that otherwise have static parameters. The layout's `revalidate = 86_400` is not evidence of publicly cached HTML while the render requires a connection. Several detail pages also explicitly set `force-dynamic` and await `connection()`.
2. The comment and `src/lib/data/freshness.ts` establish a real requirement: public evidence and admission eligibility advance with **Asia/Shanghai** dates. Removing the dynamic boundary without replacing its freshness guarantee risks exposing expired qualifications.
3. `React.cache` deduplicates within a render; an instance-level data cache can remove repeated validation/projection CPU while dynamic HTML still invokes the function. Such a cache is per runtime instance, not a distributed cache or proof of a CDN hit.
4. Public API success responses use `catalogCacheControl`; error responses use `no-store`. Existing policy caps browser age at 60 seconds, shared age at 300 seconds, and stale window at 300 seconds. The sum of shared age and stale window is capped at the remaining seconds before China midnight; the final partial second is `no-store`.
5. Public API routes use `force-dynamic`. Actual response headers and repeated **Vercel** cache outcomes must be observed after service restoration; neither the export nor an `s-maxage` string alone proves a CDN hit. Authenticated/admin/notification responses must retain separate private/no-store behavior.

Recommendation for this round: prioritize strict, invalidation-aware process data caching and retain the existing dynamic public HTML boundaries. A subsequent HTML/CDN phase needs an explicit day-boundary expiry mechanism, verified HTML/RSC cache variants, and authenticated-route isolation. Rolling ISR with a one-day duration is insufficient: it may retain yesterday's eligibility after midnight, and stale revalidation can extend that exposure.

An additional correctness edge to cover in this round is a response that **starts evaluation before midnight but finishes after midnight**. Header generation must not give a yesterday-evaluated payload a new full TTL merely because the clock crossed during the operation. Bind the policy to the evaluation date or force such a response to `no-store` (and re-evaluate when required by the route contract).

## Documentation and verification limits

The isolated default branch pins Next `16.4.3`; the original dirty workspace had installed Next `16.3.8`. Initial reference reading used that available installation's `connection`, CDN caching, route-segment config, and caching-without-cache-components docs. After the isolated dependencies were installed, the `16.4.3` `connection` and CDN caching guides were read again and confirmed the reviewed behavior. No paid infrastructure, plan upgrade, production deployment, alias mutation, or account restoration was attempted by this audit.

The request-spanning-midnight fix is implemented in `src/lib/catalog-api/cache-policy.ts` and `http.ts`: a public envelope's evaluation date must match the current China calendar date before caching is allowed. Responses without valid evaluation metadata also receive `no-store`, including structurally unknown repository comparison responses. The new boundary suite, existing trust-boundary suite, and cursor-binding suite passed (35 tests). Tests ran with a workspace-local `TEMP`/`TMP` directory after the sandbox's default temporary directory caused a rename permission error before any test executed. This validation concerns header policy and request semantics; it is not proof of Vercel CDN behavior.
