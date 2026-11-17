# SJTU 2027 reviewed core implementation plan

**Goal:** Add five source-reviewed direct Chinese bachelor identities and their fifteen independent 2027 admission rounds without changing existing catalogue objects.

**Architecture:** Canonical JSON stores the records. Scoped identity and field receipts bind names and facts to official source snapshots. Existing current/directory projection and public-core v2 selectors decide visibility; no schema, UI, backend or date-policy changes are needed.

**Tech stack:** Existing TypeScript/Zod data contracts, Vitest, and an in-memory SQLite import of all catalogue migrations.

1. Add regression tests in `tests/unit/sjtu-reviewed-2027.test.ts` and `tests/unit/sjtu-reviewed-2027-sql.test.ts`. Verify names, Chinese language, four-year duration, literal year, three general-admission scopes, HSK alternatives, unscored English proof, conditional preparatory separation, and rejection of missing/expired/mismatched facts. Check that the initial tests fail before the batch exists.
2. Append five programmes, fifteen cycles and four official-source summaries to `content/data/`. Programme identities contain no unsupported BEng award or full-time assertion. Annual conditions belong to each cycle. Retain the verbatim English name `Smart Energy`; do not expand it to an invented translation.
3. Append scoped name acceptances and current-leaf verifications using the existing identity/field ledger schemas. Save immutable identity, cycle and field receipts under `quality/maintenance/batches/reviewed-sjtu-2027-20261117/`. Record AI-assisted independent review accurately; do not imply personal human approval, remote model calls or cloud writes.
4. Save the quality review with source hashes, exact quote hashes, table row/bbox and merged-CSCA bindings, the private source-peer report hash, and baseline preservation hashes. Keep original PDFs, HTML and native screenshots private. Record the unselected alternate-PDF discrepancy without silently repairing it.
5. Verify every previous raw object and ledger entry by reconstructing its original array after removing only the new IDs. Preserve all prior public-core programme/cycle objects, all six old SJTU identities and the visual-media collection/brief assets. Compute actual projection counts; do not change evidence or policy to obtain a target.
6. Run the new tests and relevant six-school, public-quality, source/receipt, directory, year/round and SQL suites; full ESLint, route type generation, TypeScript, data validation, strict directory validation and diff checks. The native SQL regression must import all migrations, retain all three sequence rows, and prove that a missing annual route cannot borrow a sibling route.
7. Obtain independent implementation/receipt peer review, fix concrete findings, and create one local commit after validation. Do not push, open a PR, merge, deploy, restart port3100, invoke a model service or publish originals.

The three published Beijing-time windows remain separate. A calendar-boundary assertion about raw dates does not renew evidence after its review window. The public projection must withhold expired facts even when the original future application dates remain in canonical JSON.
