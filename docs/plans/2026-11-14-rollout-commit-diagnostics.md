# Safe rollout failure diagnostics

The existing `rollout_commit_conflict` remains the holding reason. It covers
fresh proof-reader errors, binding errors and an atomic transaction refusal;
it does not establish that a compare-and-swap race occurred.

Append `commitDiagnostic` only when the existing advance try/catch fails. Its
fixed stage distinguishes runtime, terminal and legacy proof reads, fence
construction, and prepare/bind/batch submission. The held private R2 receipt,
`rollout_held` event and authenticated API all receive the same diagnostic.
Fixed categories and an exact MaintenanceError allowlist expose no original
message, SQL, binding values, object stringification, stack or arbitrary code.
The bounded Error.cause scan handles D1 wrappers. Binding diagnostics report
statement counts and one-based unexpected primitive-type positions only;
they never transform or reject a value before the unchanged D1 operation.

All safety predicates, binding order, atomic four-statement batch, failure
reasons and success path remain in force. Reader errors converted internally
to an invalid disposition can still surface as a commit CHECK refusal; these
diagnostics do not infer an underlying CAS race or authorize any retry/waiver.

Verification covers real SQLite atomic CHECK rollback, post-proposal reader
failures, synchronous bind rejection before batch, HTTP/R2/event redaction,
quota compatibility and success without diagnostic or additional exemption.
No model, cloud deployment or production database mutation is part of this
change. The actual production root cause requires a subsequent observation.
