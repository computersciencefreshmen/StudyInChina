# Administrator live usage and five themes implementation plan

**Goal:** Publish the existing five administrator themes and show honest, source-backed MiniMax usage, quota and execution status on the authenticated production workbench.

**Architecture:** The local executor reads immutable model usage receipts and quota observations, projects a bounded credential-free snapshot, and publishes it to the existing private catalog Worker. The authenticated Next.js administrator API reads that snapshot. The five existing themes share the same live workbench and never replace live measurements with preview data.

**Tech stack:** Installed Next.js 16.3.5, React, TypeScript, Zod, Node.js, Cloudflare Worker/R2, Vercel, Vitest and Playwright.

## Implementation

1. Preserve existing work and inspect the five theme definitions, administrator UI, usage ledger, private telemetry schema and release scripts.
2. Use immutable usage accounting for daily and cumulative API tokens. Distinguish cache reads/writes, unknown-usage attempts, historical lower bounds, provider quota percentages and billing. Missing telemetry is unavailable; stale observations keep their acquisition timestamp.
3. Reuse all five existing themes on the real authenticated workbench. Make theme selection visible, retain responsive layouts and show real execution, catalogue and usage observations.
4. Configure the existing private telemetry transport on the catalog Worker and Vercel without exposing credentials. Launch only the telemetry bridge after verification; preserve existing paid verification work and avoid duplicate model jobs.
5. Run relevant usage/telemetry/security/unit tests, TypeScript and lint checks, production build and desktop/mobile browser checks. Capture evidence of real authenticated data and theme switching.
6. Publish the reviewed implementation with the existing Vercel release flow, verify the immutable deployment, promote the production alias and verify the public administrator workbench. Record deployment identity and material limitations.

## Acceptance

- Production `/admin` exposes the five existing themes and authenticates with the existing administrator credential.
- Missing telemetry does not display fabricated zero consumption.
- Reported token totals match the usage ledger projection; quota remains a separately dated provider measurement.
- Offline/stale executor observations are visible and never portrayed as live execution.
- Neither browser responses nor release logs contain MiniMax keys or private transport credentials.
