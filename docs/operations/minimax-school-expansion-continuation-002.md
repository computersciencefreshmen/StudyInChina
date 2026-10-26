# School expansion continuation 002

This run prioritised four schools without accepted programme directories: Beijing Foreign Studies University (BFSU), Northeast Normal University, Beijing Institute of Technology and Zhejiang Gongshang University. Five official documents were processed with the existing MiniMax-M3 subscription.

## Actual result

- Twelve new model requests completed, bringing the preserved total to 18. None has an unknown outcome. The first six requests were retained without another paid call.
- Two new programme identities passed independent agreement and the canonical importer: BFSU's Computer Science & Technology (Language Intelligence), bachelor; and Zhejiang Gongshang University's CFA undergraduate programme.
- The combined 14-candidate preview has 797 directory programmes across 20 of the fixed 272 schools. Current canonical data still has 783 across 17 schools. Current opportunities remain 738 programmes across nine schools.
- The new frozen cloud handoff contains 94 artifacts, 113 typed rows and all 18 model reservations. It is a strict superset of the first 57-artifact handoff. Its pointer was read back successfully; D1 import and stable publication remain pending.

See the [machine-readable receipt](../../quality/maintenance/2026-10-25/minimax-continuation-002.json). This is an accepted preview, not a claim that any school's full catalogue is reconciled.

## How continuation preserves the journal

The first snapshot stays immutable. Native SQLite backup copies the logical contents of all four local databases, including rows still in their write-ahead logs. Source lists may grow but cannot remove or modify prior entries. Raw evidence blobs and the six completed model reservations are copied and checksummed.

Cloud continuation is allowed only before the first D1 row-write attempt. A durable `reopening` phase blocks queued importers; an operation permit prevents an import and continuation from crossing. The previous manifest becomes permanently retired. A new manifest must retain every prior table row, artifact reference and request reservation. Separate progress keys prevent a previous offset from skipping new work. The fence continues to block ordinary model/fetch/export tasks until the complete handoff is acknowledged.

The source intent is checked immediately before each paid request. Missing school metadata may be bound deterministically only when the complete registered source scope has exactly one school. Explicit wrong metadata and shared sources remain rejected. Programme lists joined by commas or semicolons are held rather than turned into a single invented degree.

## Remaining source work

Northeast Normal University's captured guide links to its actual programme table; Beijing Institute of Technology's captured page is a general graduate guide. Empty programme extraction is retained until concrete catalogue evidence is obtained. Two Zhejiang Gongshang names disagreed between independent passes, and the BFSU scholarship provider type also disagreed; these remain held.

Four institutions outside the fixed cohort now have separate official-source discovery leads: Beijing Institute of Fashion Technology, Beijing Institute of Graphic Communication, Capital Medical University and the National Academy of Chinese Theatre Arts. Their institutional and programme admission workflow has not been activated. Their original documents have not been archived, and their past-cycle materials do not establish current application openings.

The cloud database's daily allowance is still exhausted. Its reported reset is **26 October 2026, 00:00 UTC / 08:00 Asia/Shanghai**. The existing scheduled cloud tick requeues the current manifest, retaining all earlier attempts; it does not need this computer to remain online after upload.
