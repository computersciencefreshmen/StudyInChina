# Data platform rollout

This document is the operational rollout contract for expanding StudyInChina from the
legacy catalog to 120, 500, and 1,000+ institutions. A school count is a coverage target,
not a completion claim. A school is complete only when its official catalog has been
reconciled and every required source category is registered or explicitly marked as
officially unavailable.

## Current implementation checkpoint

Implemented in this repository:

- separate Pipeline and Catalog D1 migrations with idempotence and integrity validation;
- private, content-addressed R2 snapshot and versioned release contracts;
- allowlisted queue ingestion, robots enforcement, redirect/SSRF controls, per-domain
  concurrency one, five-second spacing, bounded retries, and unchanged-content skipping;
- deterministic parsing followed by two independent MiniMax-M2.7 extractions for critical
  fields, grounded evidence checks, conflict isolation, and provenance storage;
- immutable release building, checksum/count validation, atomic pointer cutover, and rollback;
- versioned institution, program, cycle, scholarship, search, and current-release APIs;
- `json`, `shadow`, and `d1` application repositories for a staged Vercel cutover;
- public source/last-checked/error-report presentation with field-level value masking;
- ten pilot Source Manifests: Peking, Tsinghua, Fudan, Shanghai Jiao Tong, Zhejiang,
  Nanjing, USTC, Harbin Institute of Technology, Wuhan, and Sun Yat-sen universities;
- migration, manifest, Worker, API, release, security, and leakage regression tests;
- checksum-verified daily/monthly backup retention and isolated restore-drill tooling.

Verified staging checkpoint (not yet the active production Release):

- `1,006` official program identities: Tsinghua master's/doctorate, Zhejiang
  bachelor/master/doctorate in the registered Chinese and English catalogs, and
  Peking University's Chinese-taught international master's directory;
- `55` deduplicated scholarship identities from six registered official university
  scholarship indexes;
- `54` catalog source artifacts plus `10` institution/city dependency artifacts,
  all live, private, content-addressed, and byte/hash verified;
- `59` ambiguous PDF rows remain quarantined and cannot enter a Release.

These are official catalog identities, not a claim that every program or scholarship
is currently open. No admission cycle, deadline, fee, funding amount, or application
route is created without its own current official evidence. Identity-only records are
shown as `officially_not_announced`; announced opportunities expire from current
discovery after the locked 30-day grace rule.

Still not represented as completed production coverage:

- full program and scholarship reconciliation for the ten pilots;
- production activation of the verified staging batch and replacement of legacy
  template records;
- selection and source registration for all 120 institutions;
- two consecutive production monthly cycles meeting the expansion gates.

## Completion ledger

Each institution needs one machine-readable Source Manifest and reconciliation counters:

| Area | Required result |
|---|---|
| International admissions home | registered official URL or `source_unavailable` |
| Degree catalogs | undergraduate, master's, and doctorate accounted for |
| Non-degree catalogs | language, foundation, exchange, visiting, short-term accounted for |
| Current guide | current academic year/intake explicitly identified |
| Dynamic facts | fees, deadlines, eligibility, routes, and documents field-gated |
| Scholarships | university/faculty and applicable government routes reconciled |
| Application system | official route registered; login/captcha is never bypassed |
| Catalog reconciliation | every official directory item classified with an allowed outcome |

Allowed reconciliation outcomes are `published`, `no_individual_application`,
`officially_discontinued`, and `source_unavailable`. `CatalogReconciliation=100%` means
every discovered official item has one of those outcomes; it does not mean every field has
a known value.

## Rollout batches

1. **Ten-school pilot** — populate the registered manifests and exercise static HTML,
   tables, PDF/scanned documents, client-rendered pages, conflicts, outages, and injection
   samples end to end.
2. **Legacy catalog** — import the existing JSON idempotently, preserve IDs/slugs/links,
   run `shadow`, then replace template programs with reconciled official catalogs.
3. **First 120** — existing set plus sixty highest-priority institutions, fifteen regional
   or discipline-balancing institutions, and five complex high-impact stress cases.
4. **Five hundred** — add adapters and concurrency capacity only after two passing monthly
   cycles; archive Pipeline history to R2 by month.
5. **One thousand plus** — retain Pipeline/R2 and split historical evidence by year when
   needed; migrate Catalog to managed PostgreSQL only at the documented D1 size/query gates.

The 100-point school priority score is fixed: academic strength 25, user demand 20,
international catalog breadth 15, scholarship breadth 15, geographic/discipline value 10,
official-source collectability 10, and current-deadline urgency 5. Rankings may seed this
score but never support an admissions fact.

## Promotion gates

Do not start the next scale tier until two consecutive full monthly cycles achieve all of:

- official evidence coverage `100%`;
- published-school catalog reconciliation `100%`;
- scheduled monthly checks at least `99%`;
- reachable-source fetch success at least `97%`;
- zero failed/conflicting field leakage across UI, API, search, SEO, JSON-LD, sitemap,
  favorites, and exports;
- critical-field gold-set accuracy at least `98%`;
- oldest actionable backlog below seven days;
- predicted infrastructure spend below CNY 80.

At CNY 60, alert. At CNY 80, reserve browser rendering for deadlines, admissions, and
scholarships. At CNY 95, freeze lower-priority discovery and protect existing-school checks.
MiniMax exhaustion delays extraction; it never changes a missing value into a guessed value.

## Cutover runbook

1. Apply Pipeline and Catalog migrations and run `npm run validate:d1`.
2. Validate Source Manifests and Workers; install Cloudflare secrets outside the repository.
3. Build a release with `npm run catalog:build` and upload its exact checksum-addressed bytes.
4. Run Vercel with `CATALOG_BACKEND=shadow`; retain JSON as the response source and inspect
   structured differences.
5. Switch Preview to `d1`, verify public/private endpoint behavior and leakage tests, then
   atomically activate the validated Release.
6. Switch Production to `d1`. Keep the previous Release and generated JSON compatibility
   snapshot for rollback.
7. Verify daily exports, retention rules, and an isolated restore drill before declaring the
   production cutover complete.

