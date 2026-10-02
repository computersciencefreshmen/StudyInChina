# MiniMax administrator execution repair

The goal is to make authenticated administrator actions start real, observable
catalog comparison work and preserve useful automatic continuation. The website
sends typed commands to a private queue; the local executor claims each command
once, runs the verifier, and uploads sanitized acknowledgements and usage.

The implementation checks three boundaries independently:

1. Transport freshness and execution capability. Monitoring-only uploads must
   never advertise that commands can be executed. Production controls require
   the explicit website opt-in and a fresh control-capable executor observation.
2. User action and durable acknowledgement. Start, pause, and resume expose the
   matching command result, release local UI locks after a terminal result, and
   distinguish command acceptance from model or batch completion.
3. Useful verification and evidence quality. The current input hash selects the
   baseline. Completed comparisons enter targeted recovery instead of repeating
   the same baseline failures. Official quota windows, including the observed
   Shanghai end-of-day window, are checked without bypassing expiry or zero
   quota. Model output remains a candidate for independent evidence review.

Validation covers component interactions, API authorization, executor command
idempotency and process identity, quota boundaries, baseline-to-recovery handoff,
TypeScript, ESLint, a production build, and live command/model receipts. A scoped
release includes only this repair and preserves unrelated ingestion changes.

The live outcome must show a real accepted and acknowledged command, an actual
model response and recorded usage, and a running continuation process or an
explicit actionable waiting condition. No verification date or publication
status is renewed simply because MiniMax returned a response.
