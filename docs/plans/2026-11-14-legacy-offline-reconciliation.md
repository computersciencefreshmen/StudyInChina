# Reconcile the preserved offline batch against the current catalogue

The active source contains a real legacy offline handoff from an unmerged
deployment lineage. Its permanent `kind:handoff` permit is an operation mutex,
and `offlineFence` is a separate business intent lock. Neither is an ordinary
expired HTTP fetch. Phase 1 preserves all legacy KV, releases only the abandoned
handoff operation under a frozen-source audit, and imports the account state with
the business intent still held. No provider request may run yet.

## Observed evidence

- Batch `offline-d242a859-d2b9-42d6-b2bc-e26584294097`, epoch 18;
  current immutable manifest
  `3033811e23322ae65ca355a4d3a1a74ffa84297ee87aaec2775d9dc408c645d1`.
- 171 separate offline request histories: 165 completed, 3 unknown, 3 known failed.
  None overlaps the 18 native cloud requests. Counts are outcome records, not a
  claim about actual billing.
- Actual SHA/size verification passed for 894 staged blobs and their 894 upload
  receipts, 19 manifests and 18 reopen archives/pointers. The old append-only
  protocol still fails: one epoch-zero job changes only `attempt`, `due_at` and
  `updated_at`. Every original version remains archived. Paid reservations and
  model-attempt history are immutable supersets; this must be independently
  rechecked by the new reconciliation, not described as old-protocol success.
- Original catalogue hash `14b620dc...` differs from current `71f451ad...`.
  The existing immutable native-head receipt proves that head transition, but
  does not adopt these 171 requests or resolve their three unknown outcomes.
- Of 94 ready identity proposals, 67 remain new (all Northeast Normal University),
  26 already exist and one has a locale-name conflict. Another 56 were already
  held. None contains complete annual application conditions or scholarships.
- The three offline unknown requests belong to Anhui University, Nanjing
  University of Finance and Economics and Northeast Normal University. They are
  unrelated to the three previously reviewed expired-lease jobs.

## Required result

Preserve and reuse completed results, retain every unknown as unknown, and unblock
new unrelated collection only after a new, honestly named reconciliation receipt.
Never change the old control back to its obsolete head, mutate the original
manifest, manufacture its `offline_handoff_applied` acknowledgement, or call a
model to reconstruct an existing result.

The sole canonical publisher remains the existing GitHub writer. This operation
only stages authenticated historical metadata and candidate evidence in the
isolated Gmail backend. All final public changes use ordinary validation, CI and
website acknowledgement.

## Bounded operator transaction

1. Finish the genuine whole-account DO, D1 and R2 transfer. Keep target deployment
   disabled and its imported legacy intent held. Archive the copied source
   budget policy only after complete final R2 verification; prove Paid D1 recovery
   with the existing backend recheck. No old local model lane is restarted.
2. Construct a content-addressed reconciliation package from the actual archived
   evidence and the exact current catalogue snapshot. Pin migration receipt,
   manifest, all artifact descriptors, head-transition proof, current control
   revision/scope/seed/legacy guards, classification and reviewer decision.
3. Independently verify every original envelope and field reference. Promote
   staged blobs to their declared immutable canonical keys only after checking
   upload receipt, size and SHA. Existing different bytes hold; never overwrite.
4. Prepare a fixed-column, bound-value import plan for sources/owners, all 171
   model-attempt rows, derivatives and candidate projections. Existing source
   identity must match; the two known category changes require an explicit
   validated superset merge. No arbitrary SQL endpoint is introduced.
5. Preserve the original 425 offline jobs and 85 observations in the immutable
   manifest/history; do not replay that old work queue in the new scheduler.
   Import the request/result history needed for cache provenance. Classify
   proposals against the true current catalogue: at most the verified new
   identities may enter the ready queue; existing/conflicting/originally-held
   identities stay held with an external reconciliation decision record. Keep
   original source dates, proposal IDs and model review evidence.
6. Add permanent STOP guards for the exact three unknown requests, their original
   source/raw hashes, payload hashes and trusted complete-text aliases. Retain
   original SQL and DO unknown states. These are separate from the previous
   expired-lease quarantine. A guarded rejection must hold work without creating
   another artificial `unknown` job or spending quota.
7. Adopt all original reservation keys into the existing imported singleton in
   bounded chunks. Completed results require real canonical output bytes and
   exact attempt/request/source/snapshot/pass/model bindings; unknown stays
   unknown, known failure metadata stays intact. Do not overwrite an inconsistent
   existing reservation. Retain the old auxiliary records and full original
   intent in the reconciliation audit.
8. Commit a new `legacy_offline_reconciliation` receipt/event only after fresh
   row, guard, artifact and adoption readback. The DO may clear the active legacy
   intent only when that exact receipt and all adopted records match. Source
   remains frozen. A partial operation always leaves target business closed.
9. Rollout must distinguish total legacy unknown models, permanently protected
   exact legacy unknown models and unresolved models. Only the audited three,
   with unchanged tuples, immutable receipt and active no-replay protection, may
   leave the blocking count. Any extra/changed unknown or stale active attempt
   still blocks. Repeat the same proof predicate in the atomic rollout fence.
   A model outcome is never relabelled completed or unsent.
10. Resume the normal 272-to-295 upgrade and the independent three-job quarantine,
    then activate the existing services. Keep the retired M2.7 ingestion lane off.
    Before the first ordinary model tick, use a normal `modelsEnabled:false`
    control revision for real capture of the new NPU 2027 source. Pin its actual
    R2 hashes and the complete three-record fields job, then dispatch that exact
    ordinary job for the two-send Flash trial. Restore the existing 15-minute
    workflows only after all endpoint, host-pin and website checks pass.

## Verification boundary

Tests must cover catalogue drift, the exact historical job drift, independent
unknown groups, partial imports and lost responses, no replay through aliases or
new model/profile/scope keys, cached completion reuse, all SQL/DO conflicts,
receipt corruption, future scope changes, extra unknowns, and the same protection
in status and atomic rollout update. Native workerd tests prove provider traffic
is zero before the final reconciliation. Actual model calls and publication are
subsequent operational observations, never claims derived from mocks.
