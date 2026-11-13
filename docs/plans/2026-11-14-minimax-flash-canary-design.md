# Bounded MiniMax Flash field-maintenance canary

The existing catalogue pipeline captures official evidence, extracts two independent
answers, validates exact quotes and scope, then prepares reviewed proposals. This
change tests the current Flash model inside that admission path using the existing
Token Plan subscription. It does not deploy, call a provider, upgrade a plan or
change the default M3 model.

## Decision and alternatives

Use an explicit canary manifest for one short captured source and at most five
existing record targets. Field maintenance has a complete target set before a
request is sent, making both the record bound and the two-pass call bound auditable.
Identity extraction can discover up to 100 records and would need additional
output-scope rules, so it is outside this first trial.

A global model replacement would also affect unrelated jobs and retries. A new DO
namespace or model-prefixed reservation key would lose protection against historical
unknown outcomes. Keep every existing semantic reservation key and the same account
DO; opt in only the exact approved field-maintenance source/snapshot/target scope.

The separate `MINIMAX_FLASH_CANARY` JSON variable pins a version/id, source ID, raw
snapshot SHA, extracted-text SHA and a unique list of one to five record IDs.
`MINIMAX_MODEL` remains `MiniMax-M3`. Missing canary configuration preserves the
existing M3 behavior; malformed configuration cannot send a Flash request.

## Provider profile

The trial sends `MiniMax-M3.1-Flash`, `thinking: {type: "adaptive"}` and
`output_config: {effort: "low"}`, with the existing safety system message and an
8192-token output bound. Thinking tokens share that bound. Flash does not support
disabled thinking and ignores temperature, so the trial makes no determinism
claim. Keep the regional endpoint allowlist, subscription credential, real quota
observations, five-percent credit margin and urgent-work reserve.

Official references checked on 2026-11-14:

- [Anthropic compatibility and exact model/effort parameters](https://platform.minimax.cn/docs/api-reference/text-anthropic-api)
- [Existing Token Plan support without upgrading](https://platform.minimax.cn/docs/m-plan/token-plan-notice)

## Admission and durable protection

Admission retains budget, deployment controls, native-head, school/canary,
source/snapshot, parent-record and legacy STOP checks. Before first enrollment it
also proves that both original field reservation keys are absent and that no SQL
attempt belongs to this source, raw snapshot, or either pass's payload hash. A
complete bounded DO history scan must attribute every request to its original SQL
attempt. The complete bounded SQL history also checks each attempted historical
snapshot's original extracted text, canonical hash, and available observation
bindings. It uses the attempted raw snapshot rather than a source's mutable current
pointer. Identical text under another URL/raw wrapper, missing or contradictory
evidence, missing attribution, or history beyond the canary bound holds the trial.
This covers semantic aliases and DO-before-SQL crash states without clearing or
guessing their scope.

Recheck the observed DO history fingerprint inside the enrollment transaction and
require no active model permit. Persist enrollment inside `gate`, including the
configuration/profile hashes, exact two keys and at most two send-started attempts.
Changing the trial ID cannot reset the bound. A pre-send failure can conservatively
consume a trial slot; exceeding two attempts requires operator review rather than
automatic extra requests. The independent pass requires a completed primary pass.

Completed legacy M3 requests may return their exact cached output. Unknown and
send-started requests remain protected. Known failed requests cannot switch model
profiles on retry. Removing the canary variable does not authorize an M3 retry of
the enrolled snapshot or erase its call budget. Unrelated M3 sources remain usable.

Flash reservations, SQL attempt metadata and immutable output artifacts record the
actual model, thinking/effort profile, profile hash and provider request-body hash.
The request-payload hash and semantic keys retain their existing meanings. Existing
fixed-M3 historical correspondence proofs remain unchanged. Keeping the new state
inside the existing gate/reservation values lets the complete DO migration protocol
preserve it without an unrecognized KV key.

## Evidence and verification

Only short, complete saved text is eligible. The source/raw/text hashes, target
bindings and both field payloads must agree with current captured evidence and
targets. The engine's quote, annual/track scope, schema and independent agreement
checks remain unchanged. Long partitions, other engines and target sets above five
do not enter the trial or silently fall back to another paid profile.

Focused tests use fake quota/model transports and real local storage where useful.
Cover two-pass success and audit hashes, strict two-send bound including failures,
old completed reuse, old unknown refusal, cross-profile retries, source/target/text
drift, unattributed history, enrollment races, rollback to default M3, and unchanged
ordinary M3 behavior. Root binds the actual new official source only after separate
CI and migration completion; no real provider verification is claimed by this PR.
