# Candidate and stable website smoke implementation plan

**Goal:** Prove that an exact reviewed catalogue is visible through the deployed API, university pages and applicant-facing program pages before and after promotion.

**Architecture:** A read-only TypeScript runner receives a frozen catalogue directory, source plan, approved batch files and target URL. It derives the expected public records for an explicit China-calendar date, uses bounded parallel API/HTML checks, then checks real browser rendering and navigation. A new output directory is required; proof and screenshots are written once and bind the runner, inputs and source-plan hashes. Protection bypass is accepted only through an environment variable and is never persisted or logged.

**Tech Stack:** Existing Playwright/Chromium (installed Chrome channel on this machine), parse5 for decoded server-rendered HTML, existing catalogue types and publication policy, Node cryptographic hashes.

1. Create `scripts/quality/release-public-smoke.ts` with explicit CLI parsing and an importable runner. Validate target, paths, expected counts, batch identities and source-plan pins before making requests. `--help` must not start a browser or access the network.
2. Read all cursor pages for programs and institutions, verify exact IDs, counts, duration round trips and each changed program/cycle. Check all university pages against the actual expected program count, listing links and empty-state behavior.
3. Render each changed detail in all six launch locales. Require every localized eligibility/material/notes/tuition-schedule string, exact duration, teaching medium, fee and reference marker. Verify the primary CTA goes to the official source when the opening date is unknown. Check stale HTML/API detail endpoints return 404.
4. Use a real browser to click city → university → program. Check mobile viewport geometry and capture the resulting program page. Record console/page errors as failures, without credentials.
5. Write an immutable pass/fail proof even when verification fails; include runner SHA, exact expected input manifest SHA, source-plan SHA, independent check results, screenshot SHA and sanitized errors. The runner never deploys, promotes, applies batches or changes Git.
6. Verify parsing, hash/identity validation, tamper rejection and syntax/type/lint locally; run the complete candidate checks only once root supplies the actual qualified candidate URL and frozen expected inputs. Do not fake a 766-record success against an older deployment.
