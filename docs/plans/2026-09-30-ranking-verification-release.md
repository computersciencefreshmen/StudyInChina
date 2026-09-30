# Ranking filters and catalog verification implementation plan

**Goal:** Publish QS, THE, U.S. News global and ARWU filters across university, program and scholarship discovery, and start resumable MiniMax verification of the complete current catalog.

**Architecture:** Ranking evidence belongs to a university and is inherited through program and scholarship relationships. Shared predicates and URL parameters keep pages and APIs consistent. The verifier freezes the six input collections, captures official evidence, calls the configured MiniMax provider, and records field-level candidates without changing published facts. Production retains the audited JSON backend.

**Tech stack:** Next.js 16.3.5 App Router, React, TypeScript, Zod, Vitest, Playwright, Vercel and the current CC Switch MiniMax provider.

## 1. Review existing implementation

- Preserve current uncommitted work and inspect relevant bundled Next.js documentation.
- Check `src/lib/data/rankings.ts`, three explorer components, catalog repositories and API routes for consistent AND semantics, band upper bounds, freshness and unknown evidence.
- Verify with ranking tests, explorer-control tests and API regressions.

## 2. Complete real verification execution

- Review `scripts/ingestion/verify-catalog-minimax.ts` and its tests.
- Confirm current provider endpoint and model without printing credentials; inspect any existing run before starting another.
- Prepare the complete inventory, perform a bounded smoke call, then run/resume all records with bounded concurrency.
- Require captured-source evidence and retain differences as review candidates. Save progress and a reproducible input hash.

## 3. Validate the release artifact

- Run data validation, lint, typecheck and unit tests.
- Build the production application, then verify ranking submission, chips and history in desktop/mobile browsers.
- Use the real Vercel file collector to verify deployment includes ranking and verification source dependencies and excludes local reports/secrets.

## 4. Publish and verify

- Create a narrowly scoped release commit; leave unrelated historical staging and raw harvest outputs out of Git.
- Publish to the existing Vercel project with the JSON backend and review exact deployment provenance.
- Confirm immutable deployment, promote the stable alias, and check public ranking pages/API plus existing primary routes.
- Record deployment ID, commit, alias, validation outcomes, ranking coverage and verification progress in the final release report.

## Known limits

- Missing ranking metadata is unverified, never inferred to mean unranked.
- D1 ranking filtering remains explicitly unsupported until ranking persistence and SQL predicates exist.
- Completing a model batch is not proof of factual verification; official evidence and semantic review remain necessary before data promotion.
