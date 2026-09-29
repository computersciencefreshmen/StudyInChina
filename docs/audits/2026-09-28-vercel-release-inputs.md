# Vercel deployment input audit — 2026-09-28

The website and the Cloudflare catalogue are separate releases. At the start of
this audit, the public release API still reported the JSON backend, deployment
`f7206466855c6dcdcabdfd41e9ff442ad53cda62`, and data checked through 2026-08-26.
PR #30 had passed GitHub CI but its Vercel Preview failed. A green full-repository
build therefore did not establish that the actual deployment package could build.

## Confirmed failure and repair

Vercel deployment `dpl_Fw439tYXubYPMMUpRgy7UMbLUXAk` compiled the Next.js application,
then failed TypeScript checking because
`scripts/automation/operations-health.ts` could not import
`scripts/quality/comprehensive-data-audit.ts`.

The unanchored `.vercelignore` rule `quality/` removed both the root audit-output
directory and the nested source-code directory `scripts/quality/`. Vercel's real
`deploy --dry --format=json` input collector reproduced the missing module.
Anchoring the rule as `/quality/` preserves source dependencies while excluding
the large root audit artifacts. The additional `.tmp/` rule excludes local Worker
bundles from all directory levels. TypeScript build errors remain enabled.

## Reproducible deployment-package check

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/quality/verify-vercel-package.ps1 -Build
```

The verifier uses pinned Vercel CLI 58.0.0 and its real file collector, checks that
the application data and the previously missing source dependency are present,
rejects audit outputs, temporary bundles and non-example environment files, then
exports the exact regular files into a unique ignored `.pipeline-build` directory.
Every copied file is checked against the collector's content hash, so concurrent
edits cannot silently change the package under verification.
With `-Build`, it performs a clean `npm ci` and `npm run build` inside that export.
It neither uploads files nor creates a deployment. The default run without
`-Build` checks and exports the package without installing dependencies.

This is intentionally separate from ordinary unit tests: local tests have access
to the complete checkout and cannot detect a source file removed before the
hosting platform receives the project.

The post-fix package contained 602 regular files. A clean dependency installation,
TypeScript checking and the full production build all passed, including 1,109
generated static pages. The original full-repository CI had also passed; the
isolated-package result specifically closes the deployment-input gap.

The 2026-09-29 follow-up explicitly excludes `.pipeline-build` exports from ESLint
and TypeScript root discovery. Their real configuration APIs confirmed that the
generated source copies are skipped and the actual application source remains
included. Vitest already restricts discovery to the root `tests/` directory.

## Publication controls observed

- Vercel project `studyinchina` belongs to the expected
  `henry-yangs-projects-c9706eac` scope and deploys the GitHub `main` branch.
- Git deployment is enabled; automatic assignment of custom domains is disabled.
  A Ready production deployment alone does not update `studyinchina.vercel.app`.
- The stable alias initially points to
  `studyinchina-jts9g7zd1-henry-yangs-projects-c9706eac.vercel.app`.
- The local Vercel CLI is authenticated. The project has an existing automation
  bypass credential; no protection settings or credentials were changed.
- GitHub still lacks `VERCEL_TOKEN`. The alias workflow correctly fails closed
  without it; an operator-assisted release must retain exact-main CI checks,
  immutable-deployment validation, stable-domain validation and rollback.
- The Cloudflare D1 catalogue is not equivalent to the public JSON catalogue;
  this website release must not switch production to D1.

Final production deployment, commit and smoke-test evidence belong in the final
release report. This input audit does not itself claim a completed deployment.
