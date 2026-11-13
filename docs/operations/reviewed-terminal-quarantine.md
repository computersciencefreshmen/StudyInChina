# Reviewed terminal quarantine for three expired maintenance jobs

The purpose is to let verified, unrelated schools advance through the existing canary rollout while preserving three unresolved historical outcomes. It does not repair an unknown model result or count it as a successful extraction. Deployment, real DO migration, scope upgrade, operator review and registration are separate operations; this change performs none of them automatically.

## Two independent controls

`lease-expired-quarantine-policy.v1.json` pins three audited job tuples, three source IDs, three original hashes and two complete-text hashes. The common model admission checks the permanent deny policy before reserving capacity, writing an attempt or contacting MiniMax. New request keys, contracts, dates, passes, models or scopes cannot waive it. A new URL with the same trusted captured full-text hash is denied too. Caller-provided hashes do not establish provenance; missing current raw/canonical metadata holds the request.

The optional disposition is narrower: it excludes only those unchanged three `unknown` job tuples from the current 295-school rollout's unresolved-job count. It keeps `totalUnknown`, `quarantinedUnknown` and `unresolvedUnknown` separate. SQL model unknowns, a fourth unknown job, active/expired execution conflicts and the existing publication/inspection gates still block rollout. Imported DO state counts are explicitly a migration-time observation, not a claim about current DO outcomes.

Historical head-reconciliation proof hashes/counters and the old legacy reservation guards remain unchanged. The completed 272→295 scope-upgrade receipt is verified before registration. A waiver does not transfer to another scope. The permanent admission deny applies across every scope.

## Proof and atomic commit

Registration requires all of the following:

- The current 295-school registry is fully seeded and targets are complete; the supplied control revision and catalogue hash still match.
- `MAINTENANCE_ENABLED=false`, the fixed Gmail target migration bindings, and the real singleton DO's finalized target status. The migration report's manifest hash, pages and state counts must match that DO status. SQL absence alone never proves a request was not sent.
- The actual immutable scope-upgrade receipt, all three exact snapshot JSON files, all original raw bytes and both complete text artifacts. Their byte hashes and source/key bindings must match the audited policy.
- All three complete job tuples unchanged, and no SQL attempt/proposal matching their sources, originals or known canonical-text aliases.
- A fresh read-only preparation (at most one hour old), followed by an explicit authenticated operator decision `quarantine_preserve_unknown_no_replay`.

The proof is written content-addressed under `maintenance/terminal-quarantine/proofs/`. Only a successful atomic D1 batch publishes its deterministic `reviewed_terminal_quarantine` event. The batch repeats the exact job, revision, catalogue, lineage and no-output checks and rejects running jobs or reserved/sending model attempts. An orphan R2 file cannot activate a waiver. Duplicate registration of the exact same proof is idempotent; a different proof cannot overwrite the committed event. There is no delete/reset API and no new table or migration.

Rollout reads and the atomic rollout update use the same exact tuple predicate, committed event and lineage/audit checks. Ordinary later control revisions retain a valid waiver in the same scope. A changed tuple, corrupt/missing proof or scope change removes the waiver. Unknown job rows, DO request reservations and legacy guards are never edited by registration.

## Operator procedure after actual migration

1. Finish and verify the real source-frozen/target-finalized DO relay. Keep its real report, including nonzero unknown/started counts. Finish the existing scope upgrade to 295 and refresh its exact catalogue-bound targets while the deployment gate remains disabled. The expired capture job follows the existing safe capture-retry recovery; it is not one of the quarantined jobs.
2. Hash the **exact bytes** of the actual relay report and upload it to the target snapshots bucket as `maintenance/terminal-quarantine/evidence/<sha256>.json`. Do not fabricate a report from SQL counts or use the test fixture. The registration endpoint checks this report against the actual DO status.
3. Read fresh `/control` and `/job-dispositions`. Create a private prepare body with these fields:

   ```json
   {
     "phase": "prepare",
     "expectedRevision": 0,
     "scopeRegistrySha256": "1481aee8a203ca4819eb3ccca17b6a76824f2d1521d6afdb98aaf2075e4710a4",
     "relayReport": {
       "objectKey": "maintenance/terminal-quarantine/evidence/<actual-report-sha256>.json",
       "sha256": "<actual-report-sha256>"
     }
   }
   ```

   Replace revision and placeholders with the actual evidence. `npm run maintenance:cloud -- job-dispositions prepare.json` performs read-only preparation and returns `evidence` and `evidenceSha256`.
4. Review that evidence and create a register body containing `phase: "register"`, the returned `evidence` and `evidenceSha256` unchanged, and `review: { "operatorId": "<operator>", "decision": "quarantine_preserve_unknown_no_replay", "reviewedAt": "<current ISO UTC time>" }`. Submit it with `npm run maintenance:cloud -- job-dispositions register.json`. Authentication uses the existing maintenance environment; never put tokens into JSON, shell output or a tracked file. A failed/stale preparation requires a fresh review rather than modified status flags.
5. Read `npm run maintenance:cloud -- job-dispositions` and `/rollout`. The expected disposition is total 3, quarantined 3, unresolved 0 only if no other unknown exists. Inspect the returned proof hash and the retained migration-time DO counts. Then use the ordinary deployment/control activation and rollout process; this endpoint does not enable models or advance canaries.

The endpoint is authenticated and limited to 32 KiB. It remains available during a budget hold as an explicit safety/recovery operation: it makes no provider call, does not enable background processing and cannot reset spending or reservations. Normal work and rollout still obey their existing budget gates.

## Validation boundary

Tests use the actual downloaded public school originals and snapshot metadata with real SHA-256, a local SQLite transaction adapter and native Miniflare/workerd. They cover registration/CAS races, late output, changed target tuples, corrupted hashes, scope changes, a fourth unknown, SQL model unknowns, duplicate registration, permanent alias denial and zero provider/attempt creation. Test-only finalized DO state is never an operational registration artifact. A real registration is still blocked until the actual finalized migration evidence exists in the target account.
