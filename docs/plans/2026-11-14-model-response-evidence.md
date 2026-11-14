# Preserve received model responses before validating output

The maintenance pipeline must distinguish a confirmed unusable response from an
ambiguous paid request. Previously a JSON parse error or `max_tokens` result
reached the same catch as a lost network reply, without retaining the received
HTTP body. This prevented diagnosis and conservatively held the request unknown.

For future requests, consume at most the existing 2 MiB bound, then conditionally
store the exact bytes and a hash-bound response envelope in R2. Read both objects
back before persisting the response reference and usage in the existing SQL
attempt. The envelope binds attempt, reservation, request hash, source, snapshot,
pass, requested/reported model, HTTP status, stop reason and reported usage. It
contains neither authorization headers nor the request payload. Missing usage
remains unknown. R2 holds private evidence; public API errors contain fixed codes.

Only after this evidence is confirmed may an empty/invalid JSON response, missing
text or a token-limit output become `known_failed`, with `retryable: false`.
Received HTTP 429 retains the existing durable cooldown and retry semantics.
Transport, redirects, incomplete or oversized bodies, archival/readback failures,
and uncertain later persistence remain unknown. A confirmed evidence reference
and usage survive a later output-artifact failure. Provider-reported Flash model
mismatches keep the existing unknown outcome and never accept output.

The wire request, output validation, admission limits, send counters and semantic
reservation keys do not change. Existing unknown reservations and SQL rows are
never reclassified or replayed. No schema migration or new background worker is
required: immutable R2 evidence complements `usage_json`, whose ordinary token
metrics remain at their existing top-level keys. Tests run the actual admission
path, failure injections and native workerd with real local D1/R2; all provider
responses are intercepted fixtures, with no real model calls.
