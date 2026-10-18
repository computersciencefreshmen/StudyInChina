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

## Human webpage step completed; server verification pending

GitHub Actions now has `ADMIN_TELEMETRY_URL` and `ADMIN_TELEMETRY_TOKEN`. The owner completed the separate `VERCEL_TOKEN` webpage action; its name and update time were independently confirmed. A separate server-side read-only check is pending. Existing local Vercel login can execute this authorized manual batch release without extracting that login's bearer.

1. Open [Vercel Tokens](https://vercel.com/account/tokens). Create `StudyInChina Release`, choose the project's team and the narrowest available project scope, and select 90 days.
2. Open [the repository's new Actions secret page](https://github.com/computersciencefreshmen/StudyInChina/settings/secrets/actions/new). Set the name to `VERCEL_TOKEN`, paste the new value in the private Secret field, and save.
3. Verify the secret's **name and update time**, not its value. Do not send the token through chat, a command argument or a committed file.

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

The existing fifteen-minute local heartbeat remains the continuation mechanism. Read the latest state before mutating. Preserve the shared writer, fresh complete proofs, source freshness, consumed-batch rejection and paid STOP scopes. The completed webpage authentication must not trigger another coordinated reset.

The complete stable-site smoke also passed: all 255 school pages and all 60 changed localized details, with zero errors or console errors. One bounded page-drain cleanup note records two requests at intentional close; it is preserved rather than presented as an error-free cleanup count. Stable proof SHA256: `5a94f4f49b8fd1237a08ac792efed755d7df8beb67693f8e151aeda19c659f15`. Local full unit verification passed 1,552 tests with one existing skipped test using four workers; the new standalone credential checker passed five additional tests.
