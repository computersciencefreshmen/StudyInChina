<div align="center">
  <img src="./public/icon.svg" width="88" height="88" alt="Study in China Atlas" />
  <h1>Study in China Atlas</h1>
  <p><strong>Source-led discovery for international students exploring Chinese universities, programs, scholarships and study cities.</strong></p>
  <p>
    <a href="https://studyinchina.vercel.app/en"><strong>Explore the live atlas</strong></a>
    · <a href="https://studyinchina.vercel.app/en/programs">Browse programs</a>
    · <a href="https://studyinchina.vercel.app/api/v1/releases/current">Public API</a>
    · <a href="./docs/content-maintenance.md">Data policy</a>
  </p>
  <p>
    <a href="https://github.com/computersciencefreshmen/StudyInChina/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/computersciencefreshmen/StudyInChina/actions/workflows/ci.yml/badge.svg" /></a>
    <img alt="Node 24" src="https://img.shields.io/badge/Node.js-24-233056?logo=nodedotjs&logoColor=white" />
    <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-111111?logo=nextdotjs&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-245A8D?logo=typescript&logoColor=white" />
    <img alt="Cloudflare" src="https://img.shields.io/badge/Cloudflare-data_platform-EA5B0C?logo=cloudflare&logoColor=white" />
    <img alt="Vercel" src="https://img.shields.io/badge/Vercel-production-111111?logo=vercel&logoColor=white" />
  </p>
</div>

> [!IMPORTANT]
> Study in China Atlas is an independent, non-commercial public-interest directory—not a university, scholarship provider or application portal. Always confirm deadlines, fees and eligibility on the linked official source before applying or paying.

## Why this atlas exists

International applicants often have to compare hundreds of differently structured university pages, PDF notices and application systems. Study in China Atlas turns those scattered official sources into a searchable, multilingual catalogue while keeping the original evidence one click away.

The product is built around three promises:

| Discover broadly | Verify precisely | Understand uncertainty |
|---|---|---|
| Explore a national selection instead of a handful of famous universities. | Dynamic facts carry an official source, check date and publication status. | Unknown, conflicting or stale values stay empty; old cycles and guesses never fill the gap. |

## Public catalogue snapshot

<div align="center">

| **266** universities | **1,233** programs | **351** scholarships | **62** cities |
|:---:|:---:|:---:|:---:|

</div>

The public catalogue contains **63 published cycle or fee-reference records** and is backed by **2,070 registered official source records**. A published record is not automatically an open application window; the decision-oriented metrics below are evaluated for **2026-08-15** with `npm run quality:platform-scorecard`.

<details>
<summary><strong>Open the honest data-depth scorecard</strong></summary>

Record count is not the same as record completeness. These are the current depth and platform-readiness indicators:

| Quality indicator | Current baseline | Next gate |
|---|---:|---:|
| Universities below three published programs | **8** | 0 |
| Verified international-program identities | 1,233 / 1,233 · **100%** | Maintain 100% |
| Programs with a fresh 30-day disposition | 49 / 1,233 · **3.97%** | ≥ 70% |
| Programs with dated or rolling admissions | 49 / 1,233 · **3.97%** | Report honestly |
| Programs open or upcoming on the evaluation date | 10 / 1,233 · **0.81%** | Report honestly |
| Programs with duration | **61.64%** | ≥ 90% |
| Programs with an official application route | **50.85%** | ≥ 80% |
| Programs with known teaching language | **85.08%** | ≥ 95% |
| Programs with eligibility/language evidence | **6.16%** | ≥ 50% |
| Universities connected to scholarships | 204 / 266 | ≥ 230 |
| Cities with reviewed coordinates | 27 / 62 | 62 / 62 |
| Source Manifests registered | 10 / 266 | 266 / 266 |
| Completed V2 Source Manifests | 0 / 266 | 266 / 266 |
| Complete catalogue reconciliation | 0 / 266 | 266 / 266 |
| Platform quality gates passing | 3 / 14 | 14 / 14 |

The raw compatibility dataset contains 272 universities, 1,255 programs and 384 scholarships. Draft, archived, identity-conflicting or publication-ineligible records are intentionally excluded from the public numbers above.

</details>

## Current trust-platform milestone

The current release moves the project from a large static directory toward a measurable decision platform:

- quality reporting now separates verified identity, fresh disposition, dated or rolling admissions, and active or upcoming applications;
- the program explorer exposes “Open now” and “Upcoming” as first-level routes, while language switching preserves semantic filters and resets release-bound cursors;
- Favorites loads only requested IDs through a four-program comparison projection instead of serializing the entire catalogue to the browser;
- Release metadata distinguishes raw and public counts, the data-check date, evaluation date, activation time, backend and Vercel deployment SHA;
- ten pilot universities now use strict Source Manifest V2 ledgers in `in_progress` state—none is mislabeled as fully reconciled;
- daily and monthly `raw-v1` backups for both D1 databases were uploaded to private R2, read back byte-for-byte and restored into isolated local databases in **101.198 seconds** with zero foreign-key violations;
- Catalog remains on the JSON compatibility backend while D1 Shadow parity, credentials and rollback evidence are completed.

This milestone deliberately exposes the freshness gap: a fact becoming stale reduces the public count instead of silently remaining visible. That makes the lower current figures a trustworthy operational signal, not a regression hidden by optimistic counting.

## What applicants can do

- Browse universities, programs, scholarships and student cities in one coherent interface.
- Explore programs through a 17-field, applicant-oriented taxonomy, including Chinese language and international Chinese education.
- Share URL-based filters, sorting and pagination; remove active filters individually and preserve browser history.
- Move from application state and deadline to fees, language and duration through decision-first cards and detail-page application snapshots.
- Narrow programs to records with an explicit university or program scholarship relationship without claiming applicant-specific eligibility.
- Explore cities through a geographic constellation or an accessible searchable directory, then use flagship guides with official sources, FAQs and stable section links.
- Keep identity-only records available for official discovery while excluding thin pages from search-engine indexing until they meet deterministic completeness gates.
- Save records locally, compare up to four programs and print a compact comparison sheet.
- Inspect field-level source links, last-check dates and uncertainty states.
- Use English, Chinese and Russian public routes; German, French and Spanish are the first reviewed expansion routes.
- Move from discovery to the official university or scholarship application system—the atlas never receives application documents.

Portuguese and Arabic remain registered preview locales and are not publicly indexed. When translated record prose is unavailable, the interface uses an explicit English fallback rather than presenting machine output as an official translation.

## Trust model: evidence before completeness

The catalogue separates **record identity** from **field visibility**. A verified program identity may remain discoverable even when its tuition or deadline cannot safely be shown. Each dynamic field uses one of six explicit states:

```ts
type FactStatus =
  | 'known'
  | 'officially_not_announced'
  | 'not_applicable'
  | 'source_unavailable'
  | 'conflict'
  | 'stale'
```

Publication follows these rules:

1. Only allowlisted university, government and scholarship-provider sources can support a fact.
2. Every changing fact belongs to a specific academic year and intake.
3. Deterministic parsing extracts links, dates, money and page structure before model-assisted extraction.
4. High-risk fields require two independent MiniMax extractions to agree and point to locatable evidence.
5. Evidence, deterministic rules, freshness and cross-source conflict checks must all pass.
6. A failed field is published as an empty value with status metadata and an official entry link—not as a guess.
7. Immutable releases are relationship-, count- and hash-validated before the public pointer moves atomically.

Raw HTML, PDFs and screenshots stay private in R2. The public platform exposes only structured facts and the shortest necessary source context.

## System architecture

```mermaid
flowchart LR
    S["Official university, government and scholarship sources"]
    Q["Cloudflare Queues"]
    I["Ingestion Worker<br/>fetch, parse, dual validation"]
    RS[("Private R2 snapshots")]
    P[("Pipeline D1<br/>claims, evidence, quarantine")]
    E["Entity Materializer"]
    U["Publisher"]
    B["Release Builder"]
    RR[("Versioned R2 releases")]
    C[("Catalog D1<br/>immutable public projection")]
    A["Catalog API"]
    J["Generated JSON compatibility snapshot"]
    R["json / shadow / d1 Repository"]
    W["Next.js 16 on Vercel"]

    S --> Q --> I
    I --> RS
    I --> P
    P --> E --> P
    P --> U --> P
    P --> B
    B --> RR
    B --> C
    C --> A
    A --> R
    J --> R
    R --> W
```

### Why the platform is split this way

| Layer | Responsibility | Engineering reason |
|---|---|---|
| Pipeline D1 | Jobs, candidates, evidence, conflicts and quarantine | Frequent internal writes never compete with public reads. |
| Private R2 | Compressed source snapshots, PDFs, evidence assets and release exports | Cheap immutable storage makes audit and recovery possible. |
| Catalog D1 | Validated, versioned public projection | The website reads a stable release instead of half-written ingestion state. |
| Catalog Repository | `json`, `shadow` and `d1` backends | The application can compare backends and roll back without rewriting pages. |
| Next.js on Vercel | Multilingual pages, SEO, feedback and web delivery | App Router provides server rendering while Vercel supplies previews and production delivery. |

The platform foundation is implemented, but production remains deliberately compatible with the generated JSON repository while D1 shadow comparison and release-readiness gates continue. MiniMax credentials exist only as Cloudflare secrets; source content never receives database, network or execution privileges.

## Technology map

| Concern | Choice |
|---|---|
| Web application | Next.js 16 App Router, React 19, strict TypeScript 5.9 |
| Design system | Accessible custom “academic atlas” CSS, progressive enhancement |
| Collection | Cloudflare Workers, Queues, allowlisted fetch policies |
| Data and evidence | Pipeline D1, Catalog D1, private R2, immutable releases |
| Extraction | Deterministic parsers + MiniMax dual extraction + evidence grounding |
| Validation | Zod schemas, deterministic conflict/freshness/publication gates |
| Testing | Vitest 4, Testing Library, Node test runner, Playwright |
| Delivery | GitHub Actions, Vercel Preview and Production deployments |
| Observability | Release age, queue/DLQ state, source health, backup and cost signals |

## Public API

Versioned endpoints use cursor pagination. List endpoints default to `limit=24` and accept at most 100 records per request.

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/institutions` | Search and filter institutions |
| `GET /api/v1/institutions/{slug}` | Institution detail |
| `GET /api/v1/programs` | Search and filter programs |
| `GET /api/v1/programs/{slug}` | Program detail |
| `GET /api/v1/programs/{slug}/cycles` | Program admission cycles |
| `GET /api/v1/scholarships` | Search and filter scholarships |
| `GET /api/v1/scholarships/{slug}/cycles` | Scholarship cycles |
| `GET /api/v1/releases/current` | Current public release metadata |
| `GET /api/v1/double-first-class` | Double First-Class coverage view |

```bash
curl "https://studyinchina.vercel.app/api/v1/institutions?discipline=chinese-language&limit=3"
```

Program filtering supports institution, city, program type, degree, field, teaching language, academic year, intake, tuition range, application state and scholarship availability.

## Run locally

The default JSON backend works without Cloudflare credentials, so a contributor can inspect the product safely before configuring infrastructure.

```bash
git clone https://github.com/computersciencefreshmen/StudyInChina.git
cd StudyInChina
npm ci
cp .env.example .env.local
npm run dev
```

PowerShell equivalent:

```powershell
Copy-Item .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. The root route redirects to the saved or browser-preferred public locale.

Set `CONTENT_PREVIEW=true` only in local development or a Vercel Preview when you intentionally need to inspect draft content. Production ignores that switch. The feedback endpoint fails closed when Turnstile, distributed rate limiting or email delivery is missing.

## Quality gates

Every code change is expected to pass the core local gate:

```bash
npm run lint
npm run typecheck
npm test
npm run validate:data
npm run validate:d1
npm run validate:manifests
npm run build
npm run test:e2e
```

CI additionally validates Source Manifests, prompt-injection fixtures, maintenance capacity, all Worker test suites and Worker deployment dry-runs. The complete executable matrix lives in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

Data changes must satisfy a stricter rule: an increase in row count is not progress unless source coverage, current-cycle coverage, field completeness and update success improve with it.

## Repository map

```text
.github/workflows/                 CI, source checks, backups and deployments
content/data/                      generated JSON compatibility snapshot
content/source-manifests/          allowlisted official-source manifests
docs/                              architecture, operations and data policies
infra/d1/                          Pipeline and Catalog D1 migrations
scripts/catalog/                   release building and performance benchmarks
scripts/ingestion/                 manifest, source and materialization tooling
scripts/quality/                   coverage, inventory and platform scorecards
src/app/[locale]/                  localized App Router pages
src/app/api/v1/                    versioned public API compatibility routes
src/components/                    design system and product features
src/i18n/                          locale registry and reviewed interface copy
src/lib/catalog/                   json / shadow / d1 repository implementations
src/lib/data/                      schemas, publication gates and formatting
tests/unit/                        domain, API and browser-storage tests
tests/e2e/                         multilingual critical-path tests
workers/ingestion/                 fetch, snapshot, parse and extraction pipeline
workers/entity-materializer/       candidate-to-entity field mapping
workers/publisher/                 validated publication candidates
workers/release-builder/           immutable release assembly and cutover
workers/catalog-api/               public D1 API Worker
workers/localization/              gated translation pipeline (disabled by default)
```

## Release, rollback and recovery

- `main` is the production code branch; every pull request receives a Vercel Preview.
- A catalogue release is immutable and moves live only after schema, relationship, count, search and checksum validation.
- Catalog D1 retains the active release and two rollback releases; full history remains in private R2.
- A data rollback moves `currentReleaseId` back to a validated release without redeploying the application.
- An application rollback promotes the previous healthy Vercel deployment.
- Daily exports target a 24-hour recovery point; recovery restores into an isolated database before any production cutover.

See [`docs/platform-rollout.md`](./docs/platform-rollout.md), [`docs/backup-and-restore.md`](./docs/backup-and-restore.md) and [`docs/database-schema.md`](./docs/database-schema.md) for operational detail.

## Roadmap: depth before uncontrolled scale

```mermaid
flowchart LR
    N["Now<br/>266 public universities"] --> D["Data depth<br/>70% current-cycle coverage"]
    D --> T["Trust coverage<br/>266 manifests + reconciliations"]
    T --> C["D1 cutover<br/>3 releases / 72h shadow parity"]
    C --> F["500 universities<br/>after 2 healthy monthly cycles"]
    F --> K["1000+ universities<br/>quality- and cost-gated"]
```

Near-term work is measured by:

- raising the remaining 8 sparse universities to 3–5 verified international-student programs or a documented `limited` reconciliation;
- increasing fresh-disposition coverage from 3.97% to at least 70%, without counting date-free fee references as application cycles;
- reaching the six-week gates of 75% duration, 65% official application-route, 90% teaching-language and 25% requirements coverage;
- continuing after that toward the expansion gates of 90% duration, 80% application-route, 95% teaching-language and 50% requirements coverage;
- expanding scholarship-connected institutions from 204 to at least 230;
- completing 266 Source Manifests and 266 catalogue reconciliations;
- completing three matching shadow releases over at least 72 hours before Production switches to D1;
- passing two full monthly update cycles before expansion to 500, then 1,000+ institutions.

## Contributing data safely

Corrections and additions are welcome when they strengthen evidence quality.

1. Provide an official HTTPS URL from the university, government or scholarship provider.
2. Identify the academic year and intake for any deadline, fee or requirement.
3. Include the date on which the source was checked.
4. Leave unannounced values empty; do not infer them from an earlier year.
5. Never use a ranking, agency or aggregator as the sole evidence for an admissions fact.
6. Never commit passports, transcripts, health records, applicant emails or other personal application data.
7. Run lint, typecheck, tests and data validation before opening a pull request.

Use the [data-correction issue form](./.github/ISSUE_TEMPLATE/data-correction.yml) or follow the [pull-request template](./.github/pull_request_template.md). Raw collection artifacts and candidate packages belong in the private pipeline/quarantine flow, not in the public catalogue.

## Security and privacy boundaries

- Collection is limited to registered official HTTPS domains and respects access controls, robots policies and per-domain throttling.
- The platform does not bypass authentication, CAPTCHAs, `403` responses, regional restrictions or private endpoints.
- Fetch validation rejects private-network addresses, unusual ports and unregistered cross-domain redirects.
- Applicants do not create accounts and the project does not collect application documents.
- Favorites and comparison state remain in the browser.
- Feedback is protected with origin checks, Turnstile, HMAC-based rate limiting and private email delivery.

Report a security problem privately to the maintainer rather than placing secrets or exploit details in a public issue.

## Creator

Created and maintained by [Henry Yang](https://yanghanyu2023.wixsite.com/henry) as a non-commercial public-interest information project for international students.

If you spot outdated information, use the website’s private correction form and include the official source. Please never send passports, transcripts, medical records or payment information.
