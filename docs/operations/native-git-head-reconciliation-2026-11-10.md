# One audited native Git catalogue-head reconciliation

This is a prepared recovery implementation, not evidence that cloud maintenance has resumed or that the historical export was published. It adds no schedule, model call, paid resource or subscription budget. Existing source, identity, expiry, independent model review and publication gates remain in force.

## Why this repair exists

The Worker has a durable queue and remembers the exact six-JSON catalogue hash from which it exports candidates. The trusted GitHub writer independently validates an export against that same hash before changing public data. Native Git imports subsequently expanded the catalogue without advancing the Worker's control head. This correctly causes a base conflict rather than silently overwriting newer data.

Three independently observed blockers exist: D1 daily allowance waiting, the historical prepared export, and the active deployment's `MAINTENANCE_ENABLED=false`. Control-table `enabled=1` and `models_enabled=1` do not override that deployment gate. Successful scheduled GitHub jobs therefore cannot by themselves prove model work or coverage growth.

## Pinned evidence

- The old hash `14b620dcefb79b9c5c75c2b5700514da8640fafe929825b1ecda2d79dd4f7059` exactly matches Git commit `b841240bbb8a1f34d87f5df2da499c5c64e0567c` (PR #41).
- Commit `743bdc92a80b1fb9dfb9601927e056acc31c43f3` (PR #45) has hash `55ec8db81b5b81d50edd4656bda69ec790b945cdf2099a666a50c8489d678472`. Its additive transition has 23 schools, 23 programmes, 88 sources and 46 identity acceptances; all prior objects and the original fixed 272-school scope remain unchanged. Both specialized identity receipt hashes, 133 unique archived gzip paths and their raw hashes/lengths were verified. There are 74 exact text quotations and two independently visually reviewed image fields.
- The next 61 native receipt/export links form an exact continuous chain to `71f451ade04b0daaa59e1b730583072b4961900d0f590382d78d7f02df7a1972`, containing 198 accepted proposals. Commit `390c009ed4c71ff2b1d42cacb74600ec51bff529` has that catalogue hash and must remain an ancestor of the reviewed main checkout.
- The historical export `maintenance-eed42d72-246a-4d52-a616-a5d50c584b1f` was retrieved from R2 and its canonical SHA `bdacb62f8a2634e94635eb0ae9da76ebf5db451d692d4526c5f383eb775da783` verified against D1 and all 12 exact candidate bodies. It is **prepared**, with no acknowledgement. One proposal was separately accepted by a later native import; that overlap does not make this export applied or published.

The first historical transition is an audited Git bridge with specialized receipts, not a fabricated native importer receipt. The following 61 links were checked for canonical integrity, exact continuity and proposal membership; all 61 importers were not replayed. These historical identity proofs do not assert current application eligibility.

The fixed manifest is `content/maintenance/head-reconciliation-2026-11-10.v1.json`. Review documents and the original export are under `quality/maintenance/reconciliation/2026-11-10/`. The Worker accepts only this manifest hash and these exact old/new heads. It cannot reconcile arbitrary future Git changes.

## Two explicit owner operations

Use `.github/workflows/catalog-maintenance-reconcile.yml`, only by the repository owner on `main`, with operation `native-git-head-2026-11-10`. It shares the existing canonical publisher concurrency group. Later reviewed code commits may descend from the pinned source commit, but the six-JSON catalogue must still hash to the exact pinned target.

1. Deploy the reviewed controller code while preserving the current disabled deployment gate, every existing variable/secret, Durable Object binding and trigger. This deployment is separate from the repair workflow.
2. Dispatch action **prepare**. The Worker atomically records its actual original control state and disables both control lanes. The CLI downloads and verifies the real historical export, then sends a real `rejected` acknowledgement: accepted and unchanged are empty; all 12 proposal IDs are held. The original export, proposal, model and guard history is retained.
3. The `advance` transaction requires the exact revision, old head, scope, seed, guard hash and canary; the exact rejected acknowledgement; no prepared/applied exports, running/unknown jobs, live or malformed leases, reserved/send-started/unknown model attempts or staged target refreshes. It preserves the observed 18 completed model attempts and 3,509 STOP guards. It advances only the control head, clears `targets_complete`, and records immutable evidence.
4. The repair streams the fixed target payload to authenticated `/head-reconcile-targets`, preserving the native known-length request body. Its metadata pins 4,129 targets, 3,642,343 bytes and SHA `8bbfe380926b7154f8f6556a2a44f219edcae87a2a0fbde5bf95ba37a8437022`. HTTP performs no bulk JSON/schema pass. The existing Queue configuration validates full size, digest, scope and schema, then calls the existing strict target planner and 32-operation continuations. Each upload has a new immutable key, so an interrupted or invalid upload cannot poison retries or overwrite valid evidence. The ordinary `/targets` API is unchanged. Completion publishes the target flag, control revision and completion audit event in one transaction; duplicate finishing deliveries do not increment the revision again. **Prepare always stops with both control lanes disabled.**
5. After reviewing the prepare audit and paused state, separately enable the deployment gate on the same reviewed code while preserving unrelated configuration, secrets and triggers. Then dispatch action **resume**. It restores only the durable original control state when target completion, exact expected revision, subscription configuration and deployment gate all match. Any intervening operator revision holds the operation for review.

The initial cadence, original canary and MiniMax subscription/quota checks are unchanged. Enabling the gate is not proof of successful extraction or increased coverage; observe actual bounded ticks, model receipts, accepted candidates and a protected publication separately.

The target-refresh budget evidence is in `docs/operations/maintenance-target-refresh-budget-2026-11-10.json`: one local parse/schema sample used about 62 ms CPU, before planning and hashing. This identifies a risk for the documented Free HTTP CPU limit; it is not Cloudflare's actual metering. The repair reuses the already configured Queue/continuation mechanism without changing CPU limits or billing. Successful prior bootstrap does not prove this new full target consumer fits its deployed allowance; verify the actual consumer, continuations and completion receipt in the cloud before resume.

## Failures and rollback

`GET /control` is authenticated and returns only control/reconciliation metadata and configuration booleans. It avoids the full progress/status scan. Every reconciliation phase has a durable event and an immutable R2 proof; retries reuse the same original snapshot. A pause archive failure leaves the database paused and can be retried. An ambiguous transaction reply is resolved against its durable event.

Failures after pause never run an automatic cleanup/resume. Do not clear the seed, remove STOP/unknown history, alter acknowledgements to claim publication, or relax the expected revision to make a retry green. If the fixed catalogue or operator control has changed, retain the pause and review a new operation instead.

If a resume transaction commits but its reply is lost, a client failure label does not prove that control remains paused. Read authenticated `/control` and the durable resume proof before another action; a retry reuses the same operation and does not increment the revision again.

Rolling back controller code does not reverse a real rejection or the catalogue head. Safest operational rollback is the existing authenticated operator pause; preserve the durable audit and current Git data. Configuration deployment and any later resume require separate readback of the exact deployed version and control state.
