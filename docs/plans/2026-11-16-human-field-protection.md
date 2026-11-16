# Preserve existing facts during automatic imports

The publisher is isolated while this change is reviewed. Independent model review
establishes evidence integrity; it does not authorize replacing an existing fact.

Automatic field candidates may fill only absent/null/blank/empty-array/empty-object
leaves. Zero, false, populated objects and arrays remain existing facts, including
legacy facts whose authorship is unknown. Equal nonempty values are held without
renewing evidence or replacing provenance. A human field receipt (`independent` in
the canonical ledger) is preserved even when expired or equal to the new value.
This also covers human receipts staged earlier in the same batch.

Only the existing explicit `human` proposal review path may change an existing
value; deterministic and unknown methods do not become human authorization. All
original source, independent review, annual/track, value-schema and freshness
checks still run. Protection is checked before committing a staged proposal, so a
blocked proposal leaves values, source IDs, audit dates and the ledger unchanged.
The hold receipt records the exact leaf and whether human review, a human receipt,
or a same-value no-op prevented the import. Existing applied-receipt replay remains
idempotent and does not reinterpret historical publication decisions.

This change does not deploy, alter cloud controls, publish data, or change model
reservations. Full CI and operator review are required before publication resumes.
