# Controlled target reconciliation of the legacy offline ledger

This protocol reuses paid outputs while preserving unknown outcomes. It is a
new reconciliation, never an acknowledgement that the old handoff succeeded.
The source remains frozen. No route sends a model request or imports old jobs.

The three authenticated POST routes are target-only and require all four
migration bindings, a finalized target migration lock, zero live operations,
and `MAINTENANCE_ENABLED=false`. The package pins the actual database control
row, including its revision. The reviewed 272-to-295 deployment transition is
accepted without changing that row. The relay evidence must say `finalized`.

1. `/model-state-migration/reconciliation-promote` takes exactly
   `{migrationId,reconciliationSha256,offset}`. Start at offset zero. During
   `phase=history`, keep using returned `nextOffset=0`: each call verifies at
   most eight old manifests against indexed immutable financial subsets. Then
   follow artifact offsets until `nextOffset=null`. The manifest, not the
   caller, supplies each of at most eight descriptors. Each stage body and
   upload receipt is checked before a conditional canonical put; full readback
   must match. An existing different object is never overwritten.
2. Register the permanent three-unknown policy using its separate reviewed
   endpoint. `/model-state-migration/reconciliation-adopt` takes the same
   three fields. Follow offsets until all 171 original reservations have been
   adopted. Each slice verifies all 15 SQL columns and the actual canonical
   output envelope. Nine basic historical outputs do not need a raw HTTP body.
   Unknown requests stay unknown. The three known failures retain the original
   `retryable=false`, count and time metadata. The final response supplies
   `adoptedLedgerSha256` for the new receipt.
3. After the trusted SQL writer commits the exact canonical new receipt as
   `maintenance_events(event_id,kind,observed_at,details_json)`, call
   `/model-state-migration/reconciliation-finalize` with exactly
   `{migrationId,reconciliationSha256,receiptSha256,offset}`. Follow offsets.
   At most eight caches and actual artifacts are rechecked per call. The last
   call rechecks all 171 SQL rows, the exact event, fresh permanent guard proof,
   the control pin, and the entire private DO namespace before clearing the
   active intent. Any partial run retains the intent and cannot enable models.

`historyChainSha256` is the SHA of the complete canonical history-proof file
bytes. Likewise `importPlanSha256` is the raw full plan-file SHA, including its
internal checksum. Evidence references are size/hash bound, at most 8 MiB; the
large R2 checkpoint is represented by a verified summary binding its full SHA.
Raw gate/storage evidence is never uploaded as a generic R2 artifact.

Private DO keys `legacy-reconciliation:<packageSHA>` and
`legacy-reconciliation-archive:<packageSHA>` retain bounded progress and the
whole original canonical gate, original auxiliary values and baseline request
fingerprints. The final active gate removes the old fence and its source
mutex-recovery audit; both remain together in the permanent whole-gate archive.
The original auxiliary fence/adoption keys are untouched. Future model-state
migrations validate and transfer these new auxiliary entries without counting
them as requests. Unknown namespace keys remain a hard failure.

Each operation can resume from a returned cursor and repeat an earlier chunk.
A crash after an R2 put only causes exact readback, and inconsistent existing
request caches are never overwritten. No response authorizes automation:
operator review, ordinary control gates and the separate scope rollout still
apply after reconciliation.

Verification includes generated Node protocol regressions and a native
workerd/D1/R2 lifecycle. Positive generated fixtures inject only the trusted
registration-reader dependency; production HTTP uses the actual reader, whose
missing-proof rejection is exercised in both suites. The actual permanent
guard has separate real-artifact native tests. Independent private evidence
checks additionally verified all 894 actual staged objects and all 171 actual
reservation/output bindings; these private bodies are not test artifacts.
