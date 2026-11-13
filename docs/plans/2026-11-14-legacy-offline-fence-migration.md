# Preserve the pending legacy offline handoff during account migration

The observed MAX_SAFE_INTEGER permit is an intentional `kind: handoff` mutex,
not an expired fetch. Its separate `offlineFence` is a pending business intent.
This phase transfers that intent and every request unchanged. It neither imports
the old catalogue rows nor acknowledges the old handoff or enables models.

## Business admission and the complete migration

An existing `gate.offlineFence` blocks fetch/model admission before other work
and again in the final reservation transaction. Removing migration environment
flags after target finalization does not remove this business denial. Ordinary
fetch cleanup cannot release a `kind: handoff` or `kind: export` permit.

The migration recognizes the exact legacy schemas from `0cf42dfd` for
`offline-fence:<batchId>` and `offline-adoption:<batchId>`, including history,
reopen metadata, and adoption request metadata. Unknown legacy key categories or
schema fields hold. Auxiliary values are never converted into requests, model
successes, new outcomes, or acknowledgements. Ordinary migration's pre-existing
opaque extension preservation remains compatible when there is no legacy fence;
the dedicated recovery requires an exact known request envelope.

`auxiliaryEntryCount` is optional and missing means zero. Nonzero counts appear in
the manifest and status; zero-count legacy manifests retain their original bytes.
The invariant is `entryCount = requestCount + gatePresent + auxiliaryEntryCount`.
The four request-state counts still sum only to `requestCount`. Finalization
rescans every target page and verifies counts and exact original page hashes.

## Private read-only storage inspection

Authenticated source-only
`GET /model-state-migration/storage-inspection?pageIndex=0` requires a matching
durable source freeze, no export pages and zero live operations before and after
reading. Subsequent pages require `expectedStorageSha256=<first storage SHA>`.
Each canonical private page contains at most 32 original entries and 4 MiB;
the full namespace scan is limited to 4096 entries. Inspection reads unknown JSON
privately so an operator can diagnose it; it never makes it eligible for import.
Unknown auxiliary categories appear as `unsupportedEntryCount` and recovery holds.

Every value fingerprint is SHA256 of `canonical(typed(value))`. Full storage SHA
is SHA256 of canonical `{format:'studyinchina.complete-typed-storage.v1',entries}`,
where entries are sorted `[key,valueFingerprint]` pairs. The ledger hash uses the
same pairs excluding `gate` and the migration lock, with format
`studyinchina.complete-request-auxiliary-ledger.v1`. Typed encoding rejects
representations that canonical JSON cannot preserve exactly, such as undefined,
sparse arrays and negative zero.

The response binds account IDs, migration ID, the frozen state, complete storage
SHA, request/auxiliary ledger SHA, counts and each canonical `pageBytes`/SHA.
Inspection's total entry count includes the migration lock; migration's count
excludes it. Clients must bound response reads (12 MiB accommodates the encoded
4 MiB page), verify all hashes and save raw content only in private local files.
Inspection does not start an export or write a checkpoint. Its fixed flags are
`cutoverReady:false`, `modelCalls:false`, `mutation:false`.

## Explicit mutex-only recovery

Authenticated source-only
`POST /model-state-migration/handoff-operation-recovery` requires exactly:

```text
migrationId, operationId, expectedGateSha256, expectedLedgerSha256,
expectedFenceSha256, expectedHistorySha256, expectedTokenSha256,
batchId, manifestSha256, observedAt,
operator: {operatorId, decision, reason, reviewedAt}
```

The sole decision is `release_quiescent_handoff_operation_preserve_intent`.
The first mutation requires an observation no older than five minutes, a matching
source freeze at least 120 seconds old, zero live operations, no model/ordinary
fetch permits, and exactly one MAX_SAFE_INTEGER handoff permit. The exact batch,
manifest, fence ownership token hash and complete history must match. Fence phase
must remain `held_for_handoff`, `rowsStarted` must be false, and no reopen may be
in progress. `rowsStarted:false` never means that no model was sent.

One DO transaction validates the full typed request/auxiliary ledger and all
operator-pinned hashes, removes only that mutex, and retains the entire original
gate and permit in a hashed `gate.offlineHandoffOperationRecovery` audit. It
rescans the complete ledger after writing; disagreement aborts the transaction.
The fence, history, adoption metadata, requests, cooldowns and counters stay
unchanged. Exact retries reuse the audit; a new operation cannot overwrite it.
The audit migrates as part of the original gate and is never published to R2.

Afterward the unchanged export `hasInflight` rule can permit normal migration.
The target remains offline-fenced. Phase 2 must reconcile the original manifests,
all artifact bytes, catalogue differences and separate unknown outcomes before
any business intent is closed. This phase does not mint an old handoff ACK.
