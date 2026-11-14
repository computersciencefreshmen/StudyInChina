# Immutable native reconciliation catalogue

`catalog-390c009.json.gz` contains the six catalogue data files, parsed by the
current `bundleSchema`, from the exact Git commit named by the historical
reconciliation manifest: `390c009ed4c71ff2b1d42cacb74600ec51bff529`.
Its envelope records each original file's path, SHA-256 and byte length. No
runtime Git history or network access is required by the tests.

The catalogue SHA-256 is
`71f451ade04b0daaa59e1b730583072b4961900d0f590382d78d7f02df7a1972`.
Using the current target builder and the immutable 272-school registry produces
the original manifest's 4,129 targets, 3,642,343 bytes, and SHA-256
`8bbfe380926b7154f8f6556a2a44f219edcae87a2a0fbde5bf95ba37a8437022`.
The compressed fixture SHA-256 is
`931e0995936fd8a366cb042c4bfca06c2a45004626d3a0672d59454d36dfafc1`.

The client-ordering tests load this fixed catalogue rather than the current
publication candidate. They still exercise the real target builder and strict
production upload pins. A separate regression changes a catalogue fact and
requires the production path to reject it before upload and remain paused.
The historical manifest, production loader and production freshness/CAS checks
are not modified.
