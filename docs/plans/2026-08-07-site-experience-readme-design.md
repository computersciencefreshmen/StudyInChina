# Site experience and README design

Date: 2026-08-07
Status: approved for implementation

## Goal

Move the public experience from a collection of catalogue cards toward a credible,
decision-oriented international education atlas. The homepage should answer four
questions within the first two sections:

1. What can I explore here?
2. How broad is the public catalogue?
3. Why should I trust the records?
4. What should I do next?

The README should offer the same clarity to engineers and contributors: product
purpose, current public scope, evidence model, architecture, quality gates, local
workflow, deployment model and honest expansion roadmap.

## Design language

Keep the existing "Eastern academic atlas" system: warm paper, deep ink, vermilion
and jade accents, editorial typography, cartographic rules and restrained motion.
The experience should feel like a modern university yearbook and field guide, not a
generic SaaS dashboard. New sections use square editorial panels, fine rules and
large tabular figures rather than excessive pills or decorative gradients.

## Homepage information architecture

1. **Hero** — preserve the primary university/program actions and source-first
   promise.
2. **Catalogue ledger** — show runtime-derived public counts, the latest official
   source check and a direct link to the data policy.
3. **Applicant pathway** — four linked steps: discover universities, compare
   programs, verify evidence, then use the official application route.
4. **Curated institutions** — retain featured university cards.
5. **Field index** — retain all 17 applicant-oriented fields and live program counts.
6. **City constellation** — retain the compliant coordinate index.
7. **Application guides** — retain the first three guide entries.

All new user-facing copy is available for the six launch locales. Counts come from
the active catalogue repository, never from hard-coded marketing text.

## README structure

- Branded project header and live links
- Honest public-release metrics
- Product capabilities and user journey
- Source and field-state trust model
- End-to-end architecture diagram
- Technology choices and responsibilities
- Local setup and verification commands
- Repository map and public API surface
- Release, rollback, privacy and security boundaries
- Measured 257 → 500 → 1000+ roadmap

## Constraints and acceptance criteria

- No new runtime dependency.
- No invented coverage, freshness or accuracy claim.
- Preserve server rendering and progressive enhancement.
- New links are locale-aware and keyboard accessible.
- Layout remains usable at 320 px and honours reduced motion.
- Lint, typecheck, unit/data validation, production build and browser smoke tests pass.
