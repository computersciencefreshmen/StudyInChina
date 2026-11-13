# Protect the three preserved legacy model outcomes

The offline batch contains three real model outcomes that remain unknown. They
are different from the three expired-lease jobs reviewed by the terminal job
quarantine. Neither policy changes SQL/DO outcomes, produces candidates, claims
model success, deletes reservations, or retries an old request.

The fixed policy is derived from immutable manifest
`3033811e23322ae65ca355a4d3a1a74ffa84297ee87aaec2775d9dc408c645d1`.
It binds all 15 attempt columns, original source identity, and nine actually
hashed official snapshot/raw/complete-text objects. Its permanent denial matches
source, raw, reservation, payload hash and trusted complete-text aliases, before
DO reservation, quota or provider calls. It does not depend on scope or model.
Queue processing also stops protected aliases before document partitioning, so
the retained unknown cannot manufacture an additional unknown job. Caller text
hashes are ignored. Unproven source text cannot authorize a send.

## Registration and final proof

1. An authenticated operator stages the reviewed, content-addressed legacy
   reconciliation package. It pins `unknownGuardPolicySha256`,
   `unknownGuardSetSha256` and `registrationIntentSha256`. These are exported by
   `legacy-model-guards.ts`; the intent does not contain a package hash.
2. While the target's deployment is disabled and its four migration bindings
   remain present, POST `/legacy-model-guards` with exactly
   `{expectedRevision,reconciliationSha256}` (at most 1 KiB). Registration reads
   the actual package/manifest, finalized DO status and matching relay report,
   all three complete SQL tuples and nine original evidence objects.
3. The immutable canonical registration is written at
   `maintenance/legacy-model-guards/registrations/<registrationSha256>.json`.
   A single atomic D1 batch rechecks control revision/scope/catalogue/seed/legacy
   guards, all three tuples and all source identities, then appends event
   `legacy-model-guards:<packageSha256>` of kind
   `legacy_model_guards_registered`. A lost response can reuse only that exact
   package's freshly verified commit. Controls and attempt rows are not updated.
4. DO reconciliation calls
   `verifyLegacyModelGuardRegistration(env,reconciliationSha256)` directly. It
   freshly verifies the package, event, immutable registration, SQL tuples and
   original evidence, returning `policySha256`, `guardSetSha256`,
   `registrationSha256`, `exactUnknownCount:3`. It makes no RPC to its own DO.
5. The final `legacy_offline_reconciliation` receipt/event binds the actual
   registration hash after all 171 histories have genuinely been adopted. Guard
   registration alone never permits rollout.

There is no hash cycle: intent → package → registration → final receipt.

## Operational rollout only

Status and rollout report total, protected and unresolved unknown model counts
and stale active attempts. They require both immutable proofs and their exact
D1 events. Ordinary revisions can retain same-scope protection. A scope change
requires a completed additive upgrade with its immutable receipt; an arbitrary
scope removes the disposition while permanent denial remains installed.

The atomic rollout fence repeats the exact three-row count, every tuple column,
absence of a fourth unknown, stale-send exclusion, exact source identities,
registration/final events and any required upgrade record. Deletion or changing
one protected row cannot make it disappear from the fence and authorize rollout.
The existing job-quarantine fence is independently required. Historical native
head counters/fences are unchanged; their old claims are never weakened.

Tests use the original canonical manifest and nine public official objects,
stored as compressed fixtures. They exercise corruption, missing migration,
late CAS changes, fourth unknown, stale active send, 272→295 lineage, repeated
registration and real atomic rollout rollback. Native workerd intercepts every
outbound destination and proves zero quota/provider traffic or new attempt rows
for protected sources and aliases. These are local checks, not claims that a
production registration or model activation has occurred.
