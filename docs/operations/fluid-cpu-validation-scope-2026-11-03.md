# Release validation scope and Fluid CPU

The release smoke runner now separates full regression from deployed change
verification. This reduces repeated unrelated server work during a data release;
it does not measure Vercel Active CPU, establish its dominant source, or restore a
paused team.

## Verified evidence

- At main `c93a6cad17df5fc006e9fef69976cd4e5d08e79a`,
  `scripts/quality/release-public-smoke.ts` unconditionally paginated all public
  programme, institution and scholarship records and requested every public
  university HTML page, in addition to the changed-record checks.
- The runner is not invoked by any checked-in `.github/workflows` file. Its
  configured loops do not prove how often operators ran it recently.
- A committed historical candidate/stable pair proves at least one duplicated
  full remote run: both
  `quality/recovery-20261019/release-main-303e351/candidate-smoke-v1/candidate-public-smoke.json`
  and `quality/recovery-20261019/release-main-303e351/stable-smoke-v1/stable-public-smoke.json`
  report 255 university pages, 60 localized changed-programme details, all 767
  programme IDs and all 255 institution IDs. They started at
  `2026-10-18T17:01:39.874Z` and `2026-10-18T17:07:39.791Z` respectively (19 October
  in China). This pair is historical evidence, not a count of October 30 to
  November 2 runs or their CPU cost. Browser resources and prefetches can add
  requests beyond the recorded document checks.
- `.github/workflows/vercel-production-alias.yml` already has a bounded immutable
  release API probe before promotion and a stable release API probe inside the
  rollback transaction. Those checks and their security/rollback guards remain
  unchanged. Their retry loops are upper bounds, not actual invocation counts.

## Current operation

`--scope full` preserves full API ID enumeration and all-university HTML checks.
It is the default for `http://localhost` and `http://127.0.0.1`, so the existing
runner can perform the same regression on the local production build/CI without
charging remote function CPU. Existing CI content, strict directory integrity,
unit, production build and browser tests remain intact.

`--scope changed` is the default for Vercel origins. It checks:

- the global release counts and current China calendar date;
- public programme and scholarship list sentinels;
- institution API and HTML for every changed programme/scholarship affiliation,
  plus one unaffected populated and one unaffected empty institution when present;
- every changed programme's API identity, duration, teaching medium, language
  requirements and exact cycle facts;
- every changed scholarship's exact API facts (using name-filtered pagination
  because this API has no single-scholarship endpoint);
- all changed details in all public locales, mobile layouts, real browser
  navigation, and both API/HTML stale-record 404 sentinels.

The frozen input can combine multiple approved batches. Run one combined local
full regression, then the candidate/stable checks for that release. Avoid
repeating full remote checks per small data PR or extra domain. Example:

```sh
# With the production build running locally, use the same frozen expectation:
node --import tsx scripts/quality/release-public-smoke.ts --base http://localhost:3000 --input path/to/expectation.json --output quality/my-release/local-full --prefix candidate --scope full
# Candidate and stable checks follow the changed scope; outputs must be new:
node --import tsx scripts/quality/release-public-smoke.ts --base https://studyinchina-CANDIDATE.vercel.app --input path/to/expectation.json --output quality/my-release/candidate --prefix candidate --scope changed
node --import tsx scripts/quality/release-public-smoke.ts --base https://studyinchina.vercel.app --input path/to/expectation.json --output quality/my-release/stable --prefix stable --scope changed
```

Replace the candidate origin with its actual lowercase approved Vercel hostname.
Full remote regression remains available explicitly when needed. Do not run it
against the paused site to infer a CPU saving. Frozen expectation dates must
match the current China date; the runner still fails if the date changes during
the run. Source-plan pins, approval binding, stale checks, protection credential
redaction and cross-origin credential isolation retain their existing guards.

Proof JSON records `scope`, `fullCatalogEnumeration`, `plannedScope` (the selected
universities and changed programme/scholarship IDs), successfully checked
university IDs and the individual check results. A passing `changed` proof does
not claim exact global ID enumeration or full university-page coverage. Keep the
local full proof alongside remote proofs; global counts alone cannot detect an
unrelated one-for-one substitution.

## Verification and limits

`release-public-smoke.test.ts` and `release-workflow-safety.test.ts` passed 27 tests
with one Vitest worker. Tests cover local/remote defaults, explicit full override,
invalid scopes and complete changed programme/scholarship affiliations plus
unaffected state sentinels. The runner's `--help` command also passed without
network/browser activity. The first sandbox run failed before test collection
on a temporary-file rename; rerunning with `TEMP`/`TMP` inside the workspace
passed.

No remote full smoke or load test was performed for this change. Fewer unrelated
requests are an implementation result, not measured Active CPU savings. The
recent number of manual runs, route-level Active CPU and browser prefetch volume
remain unknown. These must be observed after service restoration.
