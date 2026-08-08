# Decision workspace and verified data depth

## Goal

StudyInChina already has broad catalogue coverage. This iteration turns that catalogue into a decision workspace while improving the depth of the underlying official-source data. The product must help an international applicant answer three questions quickly: what can I apply for, what does it cost, and which official page should I trust?

## Current baseline

- 257 public universities and 1,152 public programs.
- 31 universities still have fewer than three public programs.
- 25.78% of programs have a currently displayable admission cycle.
- Only a small set of program pages has complete editorial detail.
- 327 untracked collection artifacts remain quarantined until they pass official-source validation.

## Architecture

The production data path remains:

`official source -> collection/quarantine -> validation -> published JSON or Pipeline D1 -> Catalog repository -> server-rendered pages`

This iteration does not weaken that boundary. Collection artifacts are inputs, not public facts. The UI reads only the published projection selected by the same publication rules used by tests and the API.

## Product changes

1. **Progressive catalogue filters.** Search and the highest-value filters remain visible; advanced filters move into an accessible disclosure. Active filters become removable URL-backed chips. Pagination appears above and below results and communicates the visible result range.
2. **Decision-first records.** Cards and detail pages prioritise application state, deadline, tuition, duration, teaching language and the official action. An application CTA is only primary when the verified cycle is open or rolling and an official application URL exists.
3. **Application cockpit.** Program and scholarship detail pages group the current decision facts in a reusable summary, with evidence and source transparency immediately below.
4. **Indexability policy.** Public access and search-engine indexing are separate decisions. Identity-only or incomplete records remain available with `noindex,follow`; only records that meet deterministic completeness rules appear in the sitemap.
5. **Verified expansion.** Candidate collection packages are promoted only when an official HTTPS source proves an international-applicant program identity. Dynamic facts require an eligible cycle; unknown values remain unknown.

## Engineering decisions

- Keep server-rendered GET forms and URL state instead of adding a client-side filter store. This preserves shareable URLs, browser navigation and low JavaScript cost.
- Reuse the existing Eastern academic-atlas visual language instead of introducing a new design system. The iteration changes information hierarchy, not brand identity.
- Implement indexability as pure functions shared by metadata and sitemap. This prevents pages and discovery feeds from drifting apart.
- Use existing publication and validation selectors for expansion. Raw MiniMax output never bypasses schema, freshness, duplicate-identity and official-source checks.

## Acceptance criteria

- Six locales contain no new hard-coded English UI strings.
- Filter state survives refresh, sharing, back and forward navigation.
- A primary apply CTA never appears for a closed, previous-cycle or unannounced record.
- Thin records are excluded from sitemap and return `noindex,follow` metadata.
- Every newly published program has an official program-level source and a unique semantic identity.
- Lint, typecheck, unit tests, data validation, production build and Playwright E2E pass before merge.
