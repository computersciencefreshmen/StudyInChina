# StudyInChina Growth, Freshness, and Internationalization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Expand StudyInChina into a maintainable catalogue of 60 verified universities and 180 verified programs while guaranteeing that overdue admissions facts are not presented as current and preparing German, French, Spanish, Portuguese, and Arabic localization safely.

**Architecture:** Keep Git-versioned JSON as the source of truth. Compute effective freshness from audit metadata at render time, use scheduled GitHub checks to create human review work, and derive all locale behavior from one typed registry. Machine assistance may prepare translations and factual diffs, but only reviewed pull requests publish content.

**Tech Stack:** Next.js 16, React 19, strict TypeScript, Zod, Vitest, Playwright, GitHub Actions, Vercel.

---

### Task 1: Runtime freshness policy

**Files:** `src/lib/data/freshness.ts`, `src/lib/data/publication.ts`, `src/lib/data/load.ts`, `src/app/[locale]/layout.tsx`, `tests/unit/publication.test.ts`

1. Add fixed-date tests for review dates before, on, and after today.
2. Implement injectable freshness calculation.
3. Preserve overdue university/city profiles as `stale`; exclude overdue programs, cycles, and scholarships from current public data.
4. Add daily ISR so an existing deployment recalculates freshness within 24 hours.
5. Run `npm test -- tests/unit/publication.test.ts`, `npm run typecheck`, and commit.

### Task 2: Scheduled data-health enforcement

**Files:** `scripts/data-health.mjs`, `.github/workflows/data-health.yml`, `.github/workflows/freshness-gate.yml`, related tests

1. Add daily, weekly, monthly, and semester audit modes.
2. Make overdue verified public facts fail the daily gate.
3. Report verified/stale risks individually, draft backlogs as counts, and skip archived review noise.
4. Keep 404/410 as hard link failures and 403/429/timeouts as warnings.
5. Create rolling daily/weekly issues and month-specific audit issues; automation must not edit facts.
6. Run script fixtures, unit tests, and YAML review, then commit.

### Task 3: Typed locale registry

**Files:** `src/i18n/config.ts`, `src/proxy.ts`, `src/components/layout/AppHeader.tsx`, `src/lib/site.ts`, related tests

1. Define public locales (`en`, `zh`, `ru`) and preview locales (`de`, `fr`, `es`, `pt`, `ar`) in one registry.
2. Derive names, direction, Intl tags, OG tags, routing, switcher entries, static params, sitemap, and hreflang from the registry.
3. Remove hard-coded locale path matching and prevent preview codes from producing nested `/en/es` routes.
4. Keep untranslated locales out of public routes and SEO.
5. Run locale tests and type-check, then commit.

### Task 4: Translation architecture and release gates

**Files:** `src/i18n/*`, localized helpers, translation coverage tests

1. Split UI dictionaries by language and move remaining inline language branches into typed keys.
2. Add German, French, Spanish, and Portuguese dictionaries; add Arabic as preview-only.
3. Return explicit fallback metadata from localization helpers and render English fallback with `lang="en"` plus a localized pending label.
4. Enforce 100% navigation/legal/SEO coverage and at least 95% public core-content coverage before a locale becomes public.
5. Run key-parity, fallback, Intl, route, SEO, long-text, and RTL tests; publish only reviewed languages.

### Task 5: Domain model upgrades

**Files:** `src/lib/data/types.ts`, `src/lib/data/schema.ts`, `content/data/*`, validation tests

1. Add `ScholarshipCycle` for academic-year deadlines, eligibility, degree levels, restrictions, documents, route, application URL, and coverage.
2. Add sourced guide audit metadata and monthly `DataRelease` records.
3. Migrate current scholarship deadlines without inventing missing facts; keep old cycles archived.
4. Validate official sources, dates, foreign keys, and publication thresholds.

### Task 6: Verified catalogue expansion

**Files:** `content/data/*`, source-backed content PRs

1. Re-review Nanjing Normal University and all 118 existing program drafts.
2. Add 20 approved universities in four batches of five, with official admissions sources and corresponding city records.
3. Publish two to three verified programs per university and reach 60 universities, 180 programs, 20 scholarships, and 24 cities.
4. Set review periods by risk: 30 days for cycles/scholarships, 90 days for program terms, 180 days for universities, and 365 days for cities.
5. Use small factual PRs; never publish generated templates or machine-only translations.

### Task 7: Product completion

**Files:** catalogue explorers, favorites/compare, guides/cities/scholarships, SEO routes

1. Add shareable URL filters, sorting, tuition/language/scholarship/open-state filters, and 24-item pagination.
2. Persist compare selections, handle removed IDs, and render accessible printable tables.
3. Add sourced guides, scholarship-cycle views, city source details, and record-aware correction links.
4. Add OG images, breadcrumbs, structured data, and remove favorites from sitemap with `noindex`.
5. Configure feedback secrets, monitoring, branch protection, Dependabot, and CodeQL.

### Task 8: Release verification

1. Run lint, type-check, data validation, unit/component/API tests, production build, and Playwright.
2. Verify every public locale on desktop/mobile; run Arabic RTL preview checks.
3. Confirm overdue facts are absent from search, details, sitemap, and JSON-LD.
4. Run the first monthly audit, update the changelog, and create `data-YYYY-MM`.
5. Open a reviewed PR, deploy the Vercel Preview, merge to `main`, smoke-test production, and retain the previous deployment for rollback.
