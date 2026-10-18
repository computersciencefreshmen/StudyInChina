# Publishing authentication reset and verified batch release — 19 October 2026

The owner confirmed that no authentication backup remained, authorized a coordinated reset, and requested publication of the new website. PR38 had already been merged by the owner's explicit instruction at `303e3516322f7b8eed1a4cf2301d01a3c91976a3`. Its application tree contains 767 current public programmes/cycles; the previous stable site contained 757.

## Authentication and recovery

A new 64-byte random ADMIN credential was generated once in memory, encrypted with the current Windows user's DPAPI and saved at `.tmp/admin-telemetry-secret.dpapi`. The same value was supplied through anonymous stdin to Vercel Production, GitHub Actions and the `studyinchina-catalog-api` Worker. No plaintext credential is included in Git, this document, a process argument or a public report. The successful post-reset writer GET returned HTTP200, `controlEnabled: true` and the old stable deployment as current, with no active command. See `quality/recovery-20261019/authentication-reset/admin-readback-v1.json`.

Wrangler `secret put` deployed a new version of the **existing cloud Worker code** with the new binding. Local `wrangler deploy` was not run: the local configuration deliberately defaults release control to false. D1 data, paid-executor ownership and historical unknown/consumed paid scopes were not changed. A running executor reads its credential at startup; updating DPAPI does not authorize restarting it or clearing its locks.

An additional current-user DPAPI backup is stored outside the checkout at `%LOCALAPPDATA%/StudyInChina/secrets/admin-telemetry-20261019.dpapi`. Its decryption and equality with the primary encrypted credential were verified in memory. It is intended for recovery under the same Windows account/machine. If the checkout is lost again, restore this **encrypted file only**, only when the destination is absent; never overwrite an existing credential or create another token merely because a checkout is empty. Then use the existing configuration audit:

```powershell
node --conditions=react-server --import tsx scripts/ingestion/admin-executor-bridge.ts --audit-config
```

The audit confirms local configuration only. A pinned, authenticated, read-only writer GET is needed to establish server acceptance; do not print its bearer or arbitrary response headers.

## Publishing authentication verified on GitHub Actions

GitHub Actions has `ADMIN_TELEMETRY_URL`, `ADMIN_TELEMETRY_TOKEN` and the owner-created `VERCEL_TOKEN`. [The server-side credential check](https://github.com/computersciencefreshmen/StudyInChina/actions/runs/39149405552) passed at `2026-10-18T17:24:14.412Z` on commit `de3878059ba2fcdc7a8fd8976c17556a31642dd2`. It authenticated GETs against the pinned Vercel project/owner, the stable alias and the common writer; the alias and registry agreed on `dpl_EUkxVddCJFkt2KvLso15TdCEDCht`, revision 631, completed command. It performed zero cloud mutations and emitted only allowlisted metadata. Receipt: `quality/recovery-20261019/authentication-reset/github-functional-check-v1.json`. The authorized manual publication had already completed through the existing local Vercel login without extracting that login's bearer.

The owner completed the following webpage steps; do not repeat them or rotate again:

1. Created a release token through [Vercel Tokens](https://vercel.com/account/tokens), with instructions to use the project team, the narrowest available scope and a 90-day lifetime. Its actual expiry was not independently inspected.
2. Saved it as `VERCEL_TOKEN` through [GitHub Actions secrets](https://github.com/computersciencefreshmen/StudyInChina/settings/secrets/actions).
3. Confirmed the secret's name/update time, then verified its actual project access inside GitHub Actions. The token value was never retrieved from GitHub or sent through chat, command arguments or committed files.

Two native token-creation attempts did not yield a usable token. Complete personal-scope token metadata readbacks found zero exact-name matches and no further pages. Their private reconciliation records are retained; no automatic creation retry is allowed. The webpage step avoids extracting an existing login credential. Official references: [Vercel token management](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token), [GitHub secret input](https://cli.github.com/manual/gh_secret_set).

The production-alias workflow now supplies curl credentials through stdin config and Vercel credentials through its supported environment variable. It retains exact-main CI, ownership, immutable-deployment, shared-writer, rollback and public-readback checks. All nine shell blocks passed syntax checks and all nine workflow safety tests passed. Adding a secret does not make a failed CI run successful.

## Exact released website source

After the Production environment update, a new production candidate was built from 630 pinned application files of the exact merged Git tree. No private operator files were uploaded. Its source plan is `quality/recovery-20261019/release-main-303e351/source-plan.json`, SHA256 `f7328f6d8a40be901bec01f0ec3d7d863140f345174395ba1462db0330b8d983`.

Target: `dpl_EUkxVddCJFkt2KvLso15TdCEDCht`, `https://studyinchina-a2m2xmfdj-henry-yangs-projects-c9706eac.vercel.app`. Native metadata independently confirms the expected team, project, READY production state and exact `303e351` commit. The public JSON release API currently has a null `deploymentSha`; do not present it as an independent commit assertion. Commit identity is established by the native deployment metadata and the exact Git/blob source plan.

One complete candidate smoke passed: 767 exact programme IDs/cycles, all 255 university pages, ten changed programmes across seven schools in all six locales (60 details), source/application links, expired-project 404s, browser navigation and mobile layouts. Errors, console errors and cleanup errors were all zero. Proof: `candidate-smoke-v1/candidate-public-smoke.json`, SHA256 `4da629d321c3ef4d3dd963f49d34e80a3903e2d24070ce61f1568ee09456f647`. A wrapper progress label retained an old total of 54; the complete runner/proof correctly checked all 60 and the wrapper label was corrected for the stable run.

The existing shared writer reserved and claimed command `d4488cf6-4624-409c-81c4-fbf6c594bcc3`, guarded the exact current alias/registry version, performed one native alias invocation and acknowledged a completed readback. The previous stable `dpl_36sjWb43vDSYppFRYysBjgSic6NZ` remains retained. No direct unguarded alias command was used. The public stable API subsequently returned 767 programmes/cycles, 255 universities and JSON release `json:2026-10-18`, evaluated for 19 October.

## Validation and completeness remain separate

The independently approved six-school nine-route batch and ECNU v2 visiting route establish **15 covered map schools and 240 still without current projects**. They do not establish complete school catalogues or nationwide completion. The strict coverage gate remains unchanged and continues to fail. The server's exact-main CI workflow therefore remains a separate blocker for automatic alias promotion. This explicitly authorized manual batch used the existing shared CAS writer and complete website proofs; it does not rewrite CI results.

Old tests were repaired to distinguish historical raw inventory from current official public facts and to use explicit valid fixtures. No source dates, real programme facts, expiry rules or publication conditions were relaxed. A genuine SQL failure was also fixed: a 100-programme page plus parent institutions or expanded cycles exceeded D1's binding limit. Related-record reads now deduplicate and batch at 99 IDs plus one release binding. Full-page and 200-cycle regression tests retain the original full-catalogue tuition case. Those Worker SQL changes are follow-up source changes; this publication did not deploy that local Worker code or cut the website over to D1.

The existing fifteen-minute local heartbeat remains the continuation mechanism. Interactive root's authentication/publication handoff is complete; follow `quality/recovery-20261018/continuation-state.json` for current ownership. It may resume bounded batches only after the handoff commit is synchronized with its upstream and canonical writes are explicitly released. Preserve the shared writer, fresh complete proofs, source freshness, consumed-batch rejection and paid STOP scopes. The completed webpage authentication must not trigger another coordinated reset. New batches require their own reviewable GitHub delivery; merged PR38 is closed. The strict global coverage gate remains unchanged.

The complete stable-site smoke also passed: all 255 school pages and all 60 changed localized details, with zero errors or console errors. One bounded page-drain cleanup note records two requests at intentional close; it is preserved rather than presented as an error-free cleanup count. Stable proof SHA256: `5a94f4f49b8fd1237a08ac792efed755d7df8beb67693f8e151aeda19c659f15`. Local full unit verification passed 1,552 tests with one existing skipped test using four workers; the new standalone credential checker passed five additional tests.

The follow-up authentication, SQL and test changes are reviewable in [draft PR39](https://github.com/computersciencefreshmen/StudyInChina/pull/39), branch `codex/publishing-authentication-20261019`. They are distinct from the already published application source `303e351`. PR39 remains draft while strict global coverage is unresolved; no additional administrative merge was performed. The existing heartbeat configuration was read back as ACTIVE after updating its handoff; see `quality/recovery-20261019/automation-readback.json`. Interactive publication ownership is released only with the upstream synchronization gate in the current continuation state.
