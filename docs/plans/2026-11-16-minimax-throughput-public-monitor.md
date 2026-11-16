# MiniMax throughput and public read-only monitoring

The user authorizes higher concurrency, continuous cloud collection and verification, priority for concrete programmes and application conditions at low-coverage schools, and a dashboard URL without password verification. Existing subscription and cloud accounts remain in use. Original local uncommitted work remains untouched.

## Design

1. Make both actual provider admission and continuous-refill permits support a bounded configurable ceiling up to 16. Preserve default 4, cold start 2, successful-request ramp, rate-limit cooldown and decrease, quota margin, urgent maintenance reserve, durable request identity and unknown-result protection. Start production with 8; move to 16 only after healthy observed admissions. Official account RPM/TPM limits remain authoritative.
2. Scale the pending-model watermark with configured capacity, retain at most 8 selected jobs per refill, 32 outstanding jobs total and capture capacity. Raise the cloud queue consumer limit consistently with the tested configuration; preserve all storage, bindings, historical reservations and receipts.
3. Preserve school-gap and school-rotation scheduling. Source qualification remains independent of scheduling priority: official programme identity, academic year, teaching track and quoted conditions must be proven separately. Register a small reviewed batch of specific official guides through the existing source-candidate authority; registration authorizes capture, not programme applicability.
4. Add `/minimax` and a read-only public status API. The server uses the existing internal telemetry credential and builds an explicit aggregate allowlist. Public responses contain no credentials, personal information, raw provider messages, internal URLs or administrative controls. Existing administrator authentication remains required for writes.
5. Bound upstream reads and coalesce/cache public requests. Keep quota, ledger and task observation timestamps independent; cached observations age honestly, including across quota resets. Display actual completed calls and token usage separately from queued or processing tasks. Support mobile layouts and mark the page as noindex.

## Verification and release

- Test native admission at configured 8 and 16, cold-start/default/rollback behaviour, rate limiting and unknown-result preservation.
- Test refill capacity and school/award fairness without widening source or publication authority.
- Test public DTO redaction, unavailable responses, cache aging and read-only HTTP behaviour; verify desktop and phone layouts.
- Run complete GitHub CI on the exact integrated commit and merge through normal branch protection. Deploy the immutable tested worker tree to the existing Gmail account without resetting its ledger or namespaces.
- Observe actual provider calls, rate-limit responses, failure categories and quota after the 8-way pilot before raising the ceiling further. Never infer utilization from configuration alone.
- Verify that the production public dashboard loads without authentication and that existing administrator writes still require authentication. Keep current whole-application coverage and identity-only growth distinct.

## Baseline

At 2026-11-16 18:41 Beijing, the current window had 496 completed calls and 84% remaining quota. Near-hour provider latency averaged about 5 seconds, while task processing was not continuously saturated. SQL candidates are not proof of executable evidence: many condition tasks rely on inherited navigation-page discovery graphs. Higher concurrency and better source material are both necessary.

## Queue supply correction after the pilot

The eight-way pilot completed all 16 observed requests without new failures or unknown outcomes, but its recorded request overlap peaked at two. Three reviewed official 2027 guides were captured successfully after their untouched initial capture jobs received audited scheduling priority; their initial extraction jobs also received priority without changing task IDs, inputs, history or model reservations.

A regression then reproduced why newly urgent work could still wait: the persisted page offset excluded jobs inserted ahead of the old cursor. Keep a bounded urgent prefix alongside each ordinary page. The resulting metadata reservoir is at most three times 32 ordinary rows plus eight urgent rows, or 120 rows; this does not increase execution or evidence limits. Complete page counts prevent the urgent prefix from truncating ordinary work or incorrectly advancing its cursor.

Verify at most two candidate proofs concurrently after sequentially persisting their scan hints. Pair only within the existing scheduling reserve and urgency, retain planned output order, and allow already persisted programme proofs to survive a sibling maintenance-read timeout. Preserve eight proof attempts, the eight-second deadline, the 16 MiB invocation-local cache, and fresh dispatch and model-admission checks. A controlled 50 ms per-I/O fixture reduced elapsed time from about 2.5 seconds to 1.6 seconds with the same physical R2 reads; production request throughput must still be measured independently.
