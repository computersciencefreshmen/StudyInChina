# Evidence-backed school programme coverage expansion

**Goal:** Add a bounded batch of real official programmes to already-listed universities without public directory programmes, while evaluating real Vercel CPU usage after the performance release.

**Architecture:** Preserve the existing official-source capture → candidate export → strict identity importer → canonical JSON and scoped receipt → public projection → required CI → guarded Vercel release flow. Reuse process snapshots and date/receipt invalidation. Do not change public rendering, expiry rules, paid-AI quotas or release guards.

**Baseline:** Current main is `6b54d95070e240a475717cf04b102d95863605db`. The November 10 strict directory contains 278 universities and 989 programmes; 55 listed universities have no directory programme. Existing raw counts are not public coverage counts. The original workspace is dirty and remains untouched; implementation uses the independent clean clone.

## Work

1. Read actual Vercel Usage through the authenticated free console, with explicit Shanghai-day UTC ranges. Separate November 7's post-release partial day and November 10's incomplete day from complete November 8/9 observations. Record team and project CPU plus real invocation counts; do not difference rolling-month totals or infer Active CPU from HTTP latency.
2. Prioritise USTC, Xidian and Soochow University. Capture their official international-student catalogues and admissions context. Validate exact programme names, degree and only explicitly supported fields; avoid duplicate university/degree/name combinations.
3. Import approximately five programme identities per school through the existing strict importer, with actual fresh source bytes, hashes, observation timestamps and auditable international applicability. Put the canonical receipt in the existing `quality/minimum-one/<date>/<batch>/identity-import-receipt.json` tracing pattern. Do not fabricate admissions cycles, fees, deadlines or translations.
4. Compare strict public projections before/after using the same November 10 date. Verify programme identity, school coverage, language fallback and admission-opportunity counts; existing unrelated expired records must remain held. Check receipt inclusion in production file traces.
5. Run meaningful content/directory validation, typecheck, lint and production build, plus existing required CI. Use a bounded production readback only after a reviewed merge and successful guarded release. Preserve official evidence and raw CPU console readbacks.

## Acceptance and limits

- Public directory counts must actually increase at the intended previously-empty schools. Raw additions alone do not satisfy coverage.
- New directory identity does not imply an open application, current fee, complete annual admissions record or complete national coverage.
- Two complete low-traffic days under the CPU target are observations, not a capacity guarantee. Evaluate the original team budget of 336 seconds/day; the courtesy threefold quota is not the target.
- Keep the account free, avoid paid model execution and avoid large live regressions. Roll back a faulty publication through the existing common writer; do not revert unrelated facts or evidence dates.
