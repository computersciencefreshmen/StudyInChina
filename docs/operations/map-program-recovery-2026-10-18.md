# Map programme batch recovery — 18 October 2026

The human priority remains the originally empty 248 map schools, followed by the national institution universe. Count current projects actually read back from the stable website separately from source captures, reviewed canonical records and candidate deployments. One route establishes initial coverage, not full university-catalogue reconciliation.

## Recovery and current publication boundary

On resumption the primary workspace was empty, including Git metadata and local release credentials. The existing maintenance worktree still held the first published batch, but its Git pointer referenced the missing primary metadata. The primary workspace was restored from the existing remote `codex/all-university-maintenance` branch at `7c44e16`, with a clean locked dependency install. Use this restored primary checkout for future Git operations; the old managed worktree is a read-only recovery source.

The stable website was independently read on 18 October: deployment `dpl_36sjWb43vDSYppFRYysBjgSic6NZ`, 757 current public programmes/cycles, 255 map universities, 8 with programmes and 247 without. Its previous deployment remains `dpl_LDLBuyeSdaCx1ewix5adWE51qKYf`. Do not present canonical or candidate counts as stable-site publication.

Three original candidate data files were recovered from the owner/project-verified deployment `dpl_HDcttJBikiQnnHHJCAjGXqftsvpw` using the documented file APIs. The archive was processed in memory with a three-file allowlist; no environment files were extracted. Recovery receipts and the exact data are in `quality/recovery-20261018/remote-wave-2/`. That older candidate remains held and must not be promoted. Recovered facts were only proposal inputs: original evidence was reacquired and all claims were independently reviewed again.

## Reviewed batch

| University | Current routes added to the public projection | Review scope |
| --- | ---: | --- |
| Shanghai University | 1 | Spring 2027 one-semester international foundation |
| Beijing Normal University | 1 | Chinese-taught non-degree undergraduate credit study |
| Shanghai Jiao Tong University | 2 | Chinese/English spring half-year pre-university routes |
| Xi'an Jiaotong University | 2 | Chinese-taught IFP advanced 18 weeks and intensive 11 weeks |
| Fudan University | 1 | Spring 2027 one-semester Chinese language route |
| Beijing Language and Culture University | 2 | Chinese Language and TCSoL spring bachelor routes |

All nine records were consumed through the complete-programme gate with current-parent checks and sequential catalogue compare-and-swap hashes. Six are new programme identities; BLCU's two and Fudan's one reuse existing identities. Eight new intake cycles and one existing-cycle update result. The canonical projection on 18 October is **766 programmes/cycles, 14 universities with current routes and 241 zero-project map schools**. Raw totals: 2,043 programmes, 1,636 cycles, 2,574 sources, 272 universities and 396 scholarships. This is not yet a stable-site claim.

Each school directory under `quality/recovery-20261018/official/` contains fresh original bytes, robots/acquisition receipts, text or explicitly labelled PDF transcription, immutable draft versions and independent reviews. `full-program-batch-approved-v1.json` is the final approval filename for each school; its internal unique batch ID and its bound independent-review version are authoritative. BLCU and Fudan consume v2 drafts. Application receipts are preserved in `quality/program-expansion-20261013/`.

Two independent-review corrections are deliberately retained: Fudan v1 omitted the English brochure's **stable** income condition for a minor's guardian; BLCU v1 incorrectly extended the preceding Applied Chinese row's fixed campus/year arrangement into the lower merged rows. Neither held draft was applied. BLCU v2 preserves plan-dependent Hainan/Beijing study, broad-category years 1–2 and specialization years 3–4, without asserting a fixed campus for the latter. Its two annual campus rates remain explicit.

Unknown academic qualifications, numerical HSK thresholds, opening dates and registration days remain unknown where the official source does not establish them. Weeks/semesters stay literal `durationText`, with null numeric months. Fudan's CNY10,500 semester tuition remains **reference** pricing subject to the university's financial office at enrollment; its explicit reference-fee opt-in passes only with cycle-specific source proof. Generic annual options and future majors are not duplicated into new projects.

## Reusable safeguards and local database

The complete-programme consumer now rejects an already applied batch ID before reading or rewriting canonical files. A regression test replays with the *latest* valid catalogue hash and verifies that the existing receipt and all three data files remain byte-identical. This prevents an old batch from silently restoring superseded facts.

`scripts/catalog/build-local-mirror.ts` produces immutable local SQL, a complete compatibility envelope, SQLite and a manifest from the same catalogue. It applies the existing schema migrations, checks foreign keys/integrity and round-trips normalized facts. The envelope retains all eligibility, materials and notes; the current normalized SQL projection does not expose all legacy narrative fields. A local mirror is neither cloud D1 activation nor full backend parity. The actual website remains on JSON delivery.

## Publication and continuation

Build from the pinned published website source plus explicit approved overlays; never upload private local execution material. Before changing the stable alias, verify the candidate's complete public API, all map university pages, changed project conditions in six languages, source/application links, held/expired 404s and mobile navigation. The common deployment writer must reserve, claim, check the current version, mutate and read back the alias, then acknowledge the result while retaining the previous version.

The original local release authentication was lost. Vercel marks its production `ADMIN_TELEMETRY_TOKEN` as sensitive/unreadable; the safe metadata probe stopped without obtaining it, writing the cloud or replacing credentials. The human has confirmed they will restore the existing authentication locally. Never fetch runtime secret contents, rotate credentials, use an old direct-alias script or bypass the shared writer to overcome this boundary. Candidate preparation and GitHub pushes can continue.

The old local source-sweep state and SQLite ledger were also absent in the restored workspace. Tracked audit reports are historical evidence, not a replacement executable state. Preserve old receipt hashes and do not reconstruct paid scopes or replay a historical capture plan as if it were current. Fresh source preparation may use a separately named recovery state and must disclose that continuity boundary.

As last read, the existing `studyinchina-minimax` heartbeat was PAUSED. Historical documentation saying ACTIVE is superseded by that current readback. Any scheduling update must reuse this automation, preserve all paid STOP/unknown/consumed scopes and point work at the restored primary checkout and latest handoff. No duplicate canonical writer is authorized while this interactive batch owns canonical/release preparation. This session made zero paid model calls and zero cloud database writes.

PR38 stays draft: the strict one-project-per-map-university requirement still fails while 241 schools lack current projects. Existing unit-test failures must be compared against the restored branch baseline; do not weaken publication or CI gates to manufacture coverage.
