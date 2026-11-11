# Existing-school maintenance scope v2

The first expansion target is the existing catalogue's **295 raw school
identities**, including its withheld identities. This is a maintenance target,
not a claim that 295 schools have public programmes. National discovery remains
separate. `scope-295.v2.json` preserves every original school, source and host
definition from `scope-272.v1.json` and adds the other 23 existing identities with
111 already registered official source seeds. A seed is not a programme fact.

The v2 registry SHA is
`1481aee8a203ca4819eb3ccca17b6a76824f2d1521d6afdb98aaf2075e4710a4`.
Its parent is the original immutable 272-school registry. Historical exports
continue to use their own registry SHA; changing the active registry does not
rebind an old export, model reservation, source snapshot or reviewed field.

## Cloud cutover

Reuse the existing maintenance Worker, Pipeline D1, R2, Queue, subscription and
GitHub tick. Preserve actual deployed settings, including maintenance activation,
the native-head guard and extraction contract version. The v2 deployment pins
the above SHA and `SCOPE_SCHOOL_COUNT=295`. During cutover only the already
authorized original scope may finish its checked exports. New schools are
excluded from source selection and model admission until the control scope CAS
has committed.

The existing authenticated GitHub tick runs:

```powershell
node --import tsx scripts/automation/upgrade-maintenance-scope.ts --auto
```

It waits on daily quota, an unmatched catalogue head or pending publication.
When ready it reads the actual control revision and prepares one immutable
upgrade containing the current record targets. Source membership stays pinned
even if a legitimate earlier batch has advanced the factual catalogue hash.
The upload streams to R2 with its exact byte length and hash; no database access
is required to retain pending intent. An existing cloud tick can recover a lost
Queue dispatch without this computer remaining online.

Queue validation checks both registry hashes, the exact preserved original
school definitions, all added source hosts, current catalogue and legacy-guard
hashes, the expected revision and an idle publication/worker boundary. It can
install only the fixed additive `0021_maintenance_scope_upgrades.sql` table;
there is no general SQL upload interface. The upgrade pauses its own control,
applies at most 28 coalesced operations per continuation, and atomically changes
the scope only after all 295 school rows exist. Original seed identity, paid
attempts, STOP guards, source captures and old exports remain intact.

The same durable job refreshes its exact targets using the existing target
planner. It restores the original enabled/model flags only under the expected
subsequent revision, using a five-school canary for the newly added cohort.
The usual evidence-based rollout still applies. It does not certify complete
catalogues, renew unrelated conditions, buy capacity or change billing fallback.

## Recovery and observations

`GET /scope-upgrades?sha256=<upgrade SHA>` separates pending validation, staged,
completed scope CAS, successful final continuation, quota waiting and
`handed_off`. A completed scope change alone does not prove refreshed targets,
active model work or a public data release. `/status`, `/schools`, actual model
attempts and published acknowledgements retain their distinct meanings.

If a publisher wins a race before any upgrade SQL is staged, a new immutable
intent may replace the pending pointer only when the database proves that no
upgrade row or added school exists and every intervening revision belongs to an
atomic export/target-refresh chain. The old bytes and a superseding receipt are
retained; the R2 pointer changes with an ETag fence. A manual revision cannot be
explained by that chain.

A newer manual control during the operation produces a separate handoff
receipt. The pending upload remains auditable, but no longer intercepts normal
ticks or restores old flags. Partially inserted schools remain outside the
active control scope. Inspect the handoff and exact control revision before any
explicit recovery; do not delete locks, guards or historical receipts.

For an offline review, `upgrade-maintenance-scope.ts prepare` accepts an output
path, an observed expected revision and the legacy-guard SHA. `apply`, `status`
and `finish` accept that immutable file. The scheduled `--auto` path reads live
revision/head values instead of reusing a historical review file.
