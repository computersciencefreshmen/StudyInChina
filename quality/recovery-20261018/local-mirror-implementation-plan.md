# Local Catalogue Mirror Implementation Plan

**Goal:** Build a reproducible local SQLite mirror without accessing or changing cloud infrastructure.

**Architecture:** Reuse `buildLegacyRelease` for normalized SQL and the exact compatibility envelope. Apply all versioned catalogue migrations to a new SQLite file, verify integrity and foreign keys, and only then write a completion manifest and small quality receipt. The JSON delivery backend remains unchanged.

**Tech Stack:** TypeScript ESM, Node's existing `node:sqlite` runtime, current catalogue schema and SQL migrations.

1. Add one local-only utility under `scripts/catalog`, with a CLI guard requiring the expected current public programme count.
2. Preserve the exact compatibility bundle; verify literal duration wording, null numeric durations and reference-fee status against the persisted SQLite tables.
3. Add a small temporary-fixture test that reopens the database and reads facts, fees and the lossless envelope. Add an orphan-reference failure and immutable-output failure check.
4. Run the focused tests, strict lint and TypeScript checking. Do not build the canonical mirror until the approved new batch is applied.

The normalized schema intentionally does not represent every legacy narrative/material field. The compatibility envelope preserves those values exactly; successful local integrity checks are not cloud-cutover approval or proof of JSON/D1 public-view parity.
