# Study in China Atlas

An independent, source-led platform for international students comparing Chinese universities, programs, scholarships, cities and application routes.

The public interface is available in English, Chinese, Russian, German, French and Spanish. German, French and Spanish are the first expansion batch: interface and legal copy are translated, while untranslated record prose is explicitly marked and falls back to English. Arabic and Portuguese remain registered preview locales until their review gates are complete.

## Current release

- 39 verified universities across 12 student cities
- 2 verified national scholarship routes
- 5 fully sourced 2026 program pages; 113 candidate drafts and 2 archived records remain private
- Six public language routes with locale-aware dates, CNY values and explicit translation fallbacks
- Search and filters for universities and programs
- Versioned, browser-only favorites and comparison of up to four programs
- Printable comparison sheets (use the browser’s **Save as PDF** option)
- Source, verification and next-review metadata on factual records
- Secure feedback endpoint with Zod, Origin checks, Turnstile, HMAC rate limiting and Resend
- Sitemap, robots, canonical URLs, language alternates and structured detail-page data
- CI, a daily freshness gate, weekly link checks, monthly review records and semester audits

The repository is being migrated from that conservative JSON release to the automated
Catalog platform. The implemented foundation now includes separate Pipeline and Catalog
D1 schemas, immutable R2 snapshot/release contracts, queue-based ingestion, dual MiniMax
validation, atomic Catalog release cutover, versioned public API routes, and `json` / `shadow`
/ `d1` repository modes. Ten pilot institutions currently have validated Source Manifests
covering 100 registered official sources. This is infrastructure and pilot coverage—not a
claim that the full 120-school catalog has already been collected.

The initial compatibility dataset remains deliberately conservative. In the automated
Catalog, record identity and individual fact visibility are gated separately: an official
program may remain visible while a stale, conflicting, unavailable, or unannounced fee or
deadline is returned as `null` with explicit `fieldMeta` and an official entry link. Draft,
archived, or unverified identities remain private everywhere, including API, search, SEO,
JSON-LD, sitemap, and favorites.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 24 LTS |
| Application | Next.js 16 App Router, React 19, strict TypeScript |
| Styling | Tailwind build pipeline plus a custom accessible atlas design system |
| Content | Cloudflare D1 Catalog + versioned Release; JSON is a read-only compatibility snapshot |
| Collection | Cloudflare Workers, Queues, private R2 snapshots, rules + MiniMax-M2.7 dual extraction |
| Tests | Vitest, Testing Library and Playwright |
| Production | Vercel; GitHub for code, reviews and scheduled quality checks |

## Local development

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. `/` redirects to the saved or browser-preferred launch locale.

Set `CONTENT_PREVIEW=true` only in a local or Vercel Preview environment when an editor needs to inspect draft records. The production Vercel environment always ignores this switch.

Run the complete local quality gate:

```bash
npm run lint
npm run typecheck
npm test
npm run validate:data
npm run validate:manifests
npm run validate:d1
npm run test:ingestion
npm run check:worker:catalog
npm run check:worker:ingestion
npm run build
```

After a successful production build, Playwright smoke tests start that production server automatically:

```bash
npx playwright install chromium
npm run test:e2e
```

## Repository structure

```text
content/data/                legacy/read-only Catalog compatibility snapshot
content/source-manifests/    allowlisted official-source collection manifests
docs/content-maintenance.md  editorial, translation and review workflow
infra/d1/                    Pipeline and Catalog D1 migrations
scripts/                     validation, link and data-health checks
src/app/[locale]/            localized App Router pages
src/app/api/feedback/        private feedback delivery endpoint
src/components/              design system and interactive features
src/i18n/                    locale registry and launch messages
src/lib/data/                schemas, formatters and server data loader
tests/unit/                  data and browser-storage tests
tests/e2e/                   multilingual critical-path smoke tests
workers/catalog-api/         versioned public Catalog API Worker
workers/ingestion/           collection, extraction, evidence and quarantine Worker
```

## Content updates

Do not manually invent or copy an application date, fee, requirement, or scholarship
term. Every dynamic fact belongs to an academic year/intake and must be traceable to a
registered official source snapshot.

1. Register the official HTTPS source and its collection policy in the school's Source Manifest.
2. Run it through snapshot, deterministic parsing, independent dual extraction,
   evidence grounding, conflict, freshness, and release gates.
3. Store unknown or rejected values as a non-`known` `FactStatus`; never substitute an old cycle.
4. Publish a complete immutable Catalog Release and atomically advance the current pointer.
5. Treat `content/data/*.json` as generated compatibility output after D1 cutover.
6. Run the full data, migration, Worker, unit, type, lint, and build gates before deployment.

Old cycles are archived rather than overwritten. Automation may publish only facts that
pass all automatic gates; failed fields stay value-less and link to the official entry.
See the full [content maintenance policy](docs/content-maintenance.md).

## Vercel deployment

1. Import `computersciencefreshmen/StudyInChina` into Vercel and select the Next.js preset.
2. Keep the install command as `npm ci`; the repository and CI use Node.js 24.
3. Add the environment variables below to Preview and Production. Until a custom domain is configured, production canonicals default to `https://studyinchina.vercel.app`.
4. Deploy PRs as Preview deployments. Merge only after mobile, language, link and factual checks.
5. Point the custom domain at the Production deployment and redirect the `.vercel.app` host to it.
6. Set `NEXT_PUBLIC_SITE_URL` to the final canonical `https://` origin, then redeploy so sitemap, canonical and `hreflang` values are correct.
7. Enable Vercel Web Analytics and Speed Insights. Configure uptime checks for `/en`, `/en/universities`, one university detail page and `/api/feedback`.

### Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Canonical production origin |
| `CONTENT_PREVIEW` | Optional draft-content preview; keep `false` in Production |
| `CATALOG_BACKEND` | `json`, `shadow`, or `d1` Catalog repository mode |
| `CATALOG_API_URL` | Internal compatibility endpoint used during shadow/cutover |
| `CATALOG_API_TOKEN` | Optional server-only bearer token for that endpoint |
| `CATALOG_API_TOKEN_HOST` | Required exact hostname binding when the Catalog token is set |
| `CONTACT_RECIPIENT` | Private destination email; never exposed to the client |
| `RESEND_API_KEY` | Resend server API key |
| `RESEND_FROM` | Verified Resend sender |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Public Cloudflare Turnstile widget key |
| `TURNSTILE_SECRET_KEY` | Server-only Turnstile secret |
| `UPSTASH_REDIS_REST_URL` | Serverless rate-limit store |
| `UPSTASH_REDIS_REST_TOKEN` | Server-only Upstash token |
| `RATE_LIMIT_SALT` | Random secret of at least 32 characters for IP HMAC |

The feedback endpoint intentionally returns `502` in production if distributed rate limiting, verification or email delivery is not configured. This fail-closed behavior prevents unprotected form delivery.

## Release and rollback

- `main` is the production branch; every pull request receives a Vercel Preview.
- Tag each reviewed semester dataset as `data-YYYY-semester`.
- Roll back application code from Vercel’s previous stable deployment.
- Roll back Catalog data by atomically moving the pointer to the previous validated Release.
- Restore checksum-verified D1/R2 exports into an isolated database before any production recovery.
- Keep GitHub Pages disabled to avoid a duplicate, stale public copy.

## Creator

Created and maintained by [Henry Yang](https://yanghanyu2023.wixsite.com/henry) as a non-commercial public-interest information project. Corrections and suggestions should use the private contact form; never send passports, transcripts, medical records or other application documents.
