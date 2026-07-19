# Study in China Atlas

An independent, source-led platform for international students comparing Chinese universities, programs, scholarships, cities and application routes.

The public interface launches in English, Chinese and Russian. Spanish, French, Arabic and Portuguese are reserved in the locale model and remain unpublished until translation coverage and legal review meet the release thresholds described in [`docs/content-maintenance.md`](docs/content-maintenance.md).

## Current release

- 39 verified universities across 12 student cities
- 2 verified national scholarship routes
- 120 program and admission-cycle working records retained privately as review drafts
- English, Chinese and Russian routes with locale-aware dates and CNY values
- Search and filters for universities and programs
- Versioned, browser-only favorites and comparison of up to four programs
- Printable comparison sheets (use the browser’s **Save as PDF** option)
- Source, verification and next-review metadata on factual records
- Secure feedback endpoint with Zod, Origin checks, Turnstile, HMAC rate limiting and Resend
- Sitemap, robots, canonical URLs, language alternates and structured detail-page data
- CI, weekly link checks and a recurring Data Health issue

The initial dataset is deliberately conservative. Program-cycle facts remain `draft` with fees and dates set to `null` / `not-announced` until a maintainer completes a publication-level review. Production pages, search, static routes, sitemap and structured data exclude `draft` and `archived` records; only `verified` and `stale` records are public.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 24 LTS |
| Application | Next.js 16 App Router, React 19, strict TypeScript |
| Styling | Tailwind build pipeline plus a custom accessible atlas design system |
| Content | Version-controlled JSON, parsed and cross-validated with Zod |
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
npm run build
```

After a successful production build, Playwright smoke tests start that production server automatically:

```bash
npx playwright install chromium
npm run test:e2e
```

## Repository structure

```text
content/data/                versioned sources and domain records
docs/content-maintenance.md  editorial, translation and review workflow
scripts/                     validation, link and data-health checks
src/app/[locale]/            localized App Router pages
src/app/api/feedback/        private feedback delivery endpoint
src/components/              design system and interactive features
src/i18n/                    locale registry and launch messages
src/lib/data/                schemas, formatters and server data loader
tests/unit/                  data and browser-storage tests
tests/e2e/                   multilingual critical-path smoke tests
```

## Content updates

Do not edit an application date, fee, requirement or scholarship term without opening the official source for the relevant cycle.

1. Add or update the official record in `content/data/sources.json`.
2. Reference its permanent source ID from the affected record.
3. Set `verifiedAt`, `reviewAfter` and an honest `status`.
4. Store unknown facts as `null`; use `not-announced` for an unpublished cycle.
5. Update English first, then obtain human review for Chinese and Russian.
6. Run `npm run validate:data` and the full quality gate.
7. Inspect the Vercel Preview in all three launch languages before merging.

Old cycles are archived rather than overwritten. Automation reports stale records and broken links but never modifies or publishes admissions facts. See the full [content maintenance policy](docs/content-maintenance.md).

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
- Restore content using the Git tag or a focused revert; never delete historical admissions cycles.
- Keep GitHub Pages disabled to avoid a duplicate, stale public copy.

## Creator

Created and maintained by [Henry Yang](https://yanghanyu2023.wixsite.com/henry) as a non-commercial public-interest information project. Corrections and suggestions should use the private contact form; never send passports, transcripts, medical records or other application documents.
