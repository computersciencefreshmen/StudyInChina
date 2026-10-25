# Administrator release history and rollback

The workbench's **版本与回滚** section reads real catalog releases and the private deployment registry. It never infers a successful rollback from a submitted command. The current JSON/shadow website bundles data with its Vercel deployment, so restoring an approved deployment restores its interface and that deployment's data together. Independent catalog rollback is enabled only for an actual `CATALOG_BACKEND=d1` site.

## Architecture and activation

- The Next `/api/admin/releases` route requires the existing signed administrator session. POST additionally requires the existing exact-origin check and a bounded, strict typed JSON request. No browser-supplied alias, URL, executable, file path or credential is accepted.
- The server proxies the existing `ADMIN_TELEMETRY_URL`/`ADMIN_TELEMETRY_TOKEN` transport to `/internal/v1/admin-releases`. That private Worker endpoint uses the bearer credential and returns `private, no-store` responses.
- Deployment history is an immutable registration of exact READY deployment IDs, project identity, deployment URL, commit SHA and proof digest. The withdrawn `dpl_CJMi3PjUjKSeL7oRFRgNvDyC5vqf` is rejected by both Worker and actuator. An ordinary registry refresh cannot change or silently drop a registered version. Explicit capacity compaction keeps a bounded active index while preserving permanent history as described below.
- Set `ADMIN_RELEASE_CONTROL_ENABLED=true` independently in the Next server and catalog Worker only after the common writer has been deployed and configured. The committed defaults are false. Registry observation must be no older than 30 seconds to accept a new command; a stale or disconnected registry keeps controls unavailable.
- Apply additive catalog migration `0012_admin_release_rollback.sql` for independent D1 data rollback. Missing catalog migrations disable that subsection and leave real deployment history visible.

The feature code and offline tests do not prove that production configuration, registry upload, actuator execution or the GitHub workflow have been activated. Those require separate deployment and readback receipts.

## Common deployment writer

`admin-releases/writer.v1.json` in private R2 is the shared single-writer state. Conditional R2 writes bind each reservation to its observed registry hash, revision and exact current deployment. One pending, claimed or uncertain operation blocks both administrator rollback and participating GitHub promotion. Permanent command UUID receipts prevent reopening an old command after the bounded dashboard history has rolled over. Immutable per-version and per-command receipts remain under `admin-releases/versions/` and `admin-releases/commands/`.

The private machine interface is:

```text
GET /internal/v1/admin-releases?writer=1
  -> { state, registrySha256, controlEnabled }
PUT { action: "sync-registry", registry }
PUT { action: "compact-registry", expectedCurrentId, expectedRevision, expectedRegistrySha256 }
PUT { action: "reserve-promotion", request }
PUT { action: "claim", commandId }
PUT { action: "result", commandId, result }
  -> { ok: true, result }
```

`registrySha256` is SHA-256 of exact `JSON.stringify(state.registry)` after contract parsing. Administrator POST accepts only a registered target ID, exact expected current ID, revision, registry digest, command UUID and reason. A claim is admitted once; a second claim fails closed. A successful result must echo the exact previous and target IDs from actual alias readback. A failed result unlocks only when the previous deployment is still confirmed online. An uncertain result permanently blocks automatic progression until an operator reconciles the immutable command and actual provider state; there is no automatic retry or expiry-based unlock.

The active registry holds at most 20 versions. At capacity, the publisher requests the explicit compaction action before registering another version. Only the server chooses the oldest non-current entry, after checking the fixed project/alias, exact current ID/revision/digest, absence of unresolved commands and all 20 immutable version receipts. It removes one entry from the active index, preserves every historical object and actual Vercel deployment, and advances the R2 state through ETag CAS. Compaction does not refresh `observedAt`: index maintenance is not a new provider observation.

`admin-releases/archives/<operationId>/proposed.json` records intended compaction; a completed record is written only after successful state CAS. A lost reply is resolved by reading the exact 20-to-19 transition without resending the action. The client verifies the retained metadata and unchanged current deployment before continuing. Archived deployments retain their per-version receipts and previous registry snapshots. They are outside the active rollback selector; recovery of an older version requires deliberate requalification and registration, rather than an unguarded alias write. No remote compaction is performed merely to test this path below capacity.

`scripts/operations/admin-deployment-actuator.ts` uses the operator's existing local Vercel CLI login. Its local immutable reservation is recorded before alias assignment. It checks deployment ownership, project, READY/production state, registered URL, exact expected current alias immediately before mutation, and exact target after mutation. A lost response is never admitted as another assignment. The cloud service and browser never receive the Vercel credential.

The actuator must leave `deployment-promotion` commands to the GitHub owner and retain/requalify newly registered CI versions when refreshing its registry. All participating publishers must acquire this same writer; a local or legacy direct alias command is outside its serialization guarantee.

## GitHub production promotion

`.github/workflows/vercel-production-alias.yml` retains its successful exact-commit CI gate, current-main checks, immutable-deployment smoke, stable-alias smoke and candidate-failure compensation. Before either existing alias write, it invokes `scripts/operations/github-release-writer.ts` to reserve/claim the common writer and confirm the exact current alias. The same claimed operation guards compensation back to its saved previous deployment; it refuses to overwrite an unrelated external target.

Configure repository secrets `ADMIN_TELEMETRY_URL` and `ADMIN_TELEMETRY_TOKEN` in addition to the existing `VERCEL_TOKEN`. Missing shared-writer credentials or unavailable control fail the workflow before alias mutation. Dependency installation receives no deployment or private transport credentials. The helper uses typed request objects; neither shell interpolation nor logs contain a JSON credential payload. Sanitized operation/guard/result JSON is retained in a GitHub artifact, and completion is appended to private R2.

Alias transport uses the fixed project's team-scoped [Vercel alias APIs](https://vercel.com/docs/rest-api/aliases/assign-an-alias), without requiring a CLI personal-user lookup or exporting a local login. The same repository token passed project/deployment reads in the 2026-10-25 production workflow, while CLI 58 failed its user lookup with HTTP404. This distinction does not establish write permission or successful publication; the protected writer and stable readback still decide those outcomes.

Before each alias POST, the helper saves an immutable send-started receipt. Timeout, server failure, malformed response or a crash without a definite result keeps mutation status pending. The failure trap records an uncertain writer outcome and does not blindly repeat or compensate the request: one early readback of the old alias cannot rule out a late provider commit. Definitive responses still use the existing guarded compensation and final readback. These receipts are retained with the operation artifact for reconciliation.

Vercel's alias endpoint has no native compare-and-swap parameter ([official API](https://vercel.com/docs/rest-api/aliases/assign-an-alias)). This design serializes participating writers and performs exact read checks plus post-write readback. It cannot make an unrelated manual Vercel operation atomic with the private queue. Keep every automated alias writer on this shared path. Until the new workflow is active on the branch used by Actions, the previous direct writer remains an external concurrency risk.

## Independent D1 catalog rollback

Migration 0012 adds a pointer revision that advances for any actual release-pointer change, including existing publisher activation. This catches an A→B→A race even if a stale administrator sees the same current ID again. One `INSERT INTO admin_release_rollbacks` validates the expected current ID/revision, target's previous publication and validation, normalized and compatibility hashes, compatibility presence, and all six normalized row counts, then switches lifecycle states and pointer in the same SQLite transaction.

The Worker first checks the exact private R2 compatibility object's size and SHA-256. Published facts, field statuses, raw artifacts and original activation timestamps are not rewritten. Success appends immutable administrator and existing release audit rows. A reused command UUID returns its original identical receipt; changed fields conflict. Audit identities remain after ordinary release-retention purges, while purged versions remain unavailable for rollback.

## Offline validation

The focused suites cover actual in-memory SQLite trigger behavior, revision conflicts including A→B→A, bad hashes/artifacts/row counts, R2 conditional-write races, once-only claims, permanent uncertainty, unregistered/withdrawn/changed registrations, common GitHub/admin exclusion, protected route authorization/origin, UI target confirmation, and no repeated POST after an uncertain response. Existing administrator transport/authentication and production workflow safety suites are also run. No provider call or production alias change is part of these tests.

The latest feature validation passed **63 administrator tests in eight suites**, scoped ESLint and TypeScript checks. The separate local actuator suite passed **10 tests**, including a fresh alias acknowledgement before accepting a saved execution result. Catalog migration validation applied all 12 migrations twice and passed integrity/foreign-key checks; the Worker was bundled by a local dry run. These are offline engineering checks, not production activation receipts.

The parent task's broader current-tree run reported **1,984 passed / 73 failed**, across 198 passed and 37 failed test files; its complete detailed report was not retained, so exact failure grouping is unknown. A subsequent representative 15-test audit passed nine and failed six. Applying the working publication policy to the same EZ2 data reduced visible programs from 1,266 to three and scholarships from 366 to three. This is a real working-policy regression and cannot be classified as a historical fixture failure. The broader clean-baseline status remains unresolved. The administrator artifact must preserve the approved publication/freshness/selectors byte-for-byte; a later working-copy policy repair is outside this release's whitelist. Focused administrator suites and typecheck do not authorize deploying the entire dirty workspace.

The initial UI redesign was held for the user's choice. The user subsequently selected the Craft direction; its separate release candidate applies an explicit presentation whitelist over the reviewed administrator export. Administrator control remains unactivated, and source preparation performs no alias mutation, Worker activation or real catalog rollback.

## Isolated administrator release preparation

Use the approved `dpl_EZ2EyFaznRbVJuVPS6NKpKv44nwr` export at `.pipeline-build/minimax-ui-reviewed-release-2026-10-09-b729eaa7` as the website baseline. Its final `-dry.json` contains 564 exact upload fingerprints; the earlier `stablePins` precede the seven approved omission/status changes and must not be substituted. Copy only those verified files, then overlay the explicit administrator source list. Preserve every public interface and content file from EZ2. Keep the ten later visual design candidates out of this artifact. Tests and local validation receipts are a separate private support set, not deployable website files.

A read-only check through the existing host-bound private transport on 2026-10-09 returned `available=false`, `controlEnabled=false`, `registryPresent=false`, with `release_transport_unavailable`; `.tmp/admin-release-actuator/availability-readback-20261009.json` records that check. It did not establish a working online protocol or disclose the HTTP response. The actuator has not started. Before enabling controls, deploy the narrow Worker route, activate the participating GitHub writer, configure the existing private transport on both sides, and obtain a real fresh registry/readback of the approved deployments. Independent data rollback additionally requires D1 mode and migration 0012. No preparation step should silently set either release-control flag or change a production alias.

The isolated candidate `.pipeline-build/admin-reviewed-release-2026-10-09T03-47-58-606Z-bc6e11c6` reproduced all 564 final baseline pins and preserves 217 public/content files, including all ten unselected design paths. Its administrator-only source closure passed 73 tests in nine suites (63 administrator plus ten actuator), TypeScript, a local Next 16.3.8 production build with 1,117 pages, the narrow Worker dry bundle with the control flag false, and twice-applied migration integrity checks. The local build used `--webpack` to reuse an installed dependency junction; it did not change the shipped Next configuration or execute a remote build. A synthetic-authentication loopback smoke passed 13 checks: real built route authorization/origin, truthful unavailable controls, disabled command rejection, pages, and preserved public API counts of 1,266 programs and 366 scholarships. The first smoke assertion used an absent `meta.total`; it was corrected to the existing `meta.release.publicCounts` envelope, with both receipts retained. None of these checks activates production history or rollback.
