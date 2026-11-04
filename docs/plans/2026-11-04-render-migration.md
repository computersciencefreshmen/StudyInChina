# Render migration candidate

**Goal:** Prepare a reviewable Node 24 Render deployment that preserves verified catalogue semantics within the user's $5–10/month preference, without purchasing or switching production yet.

**Architecture:** One Node web service retains the current JSON data/receipt projection and instance caches. Existing Cloudflare data/executor services remain external. Render supplies the origin and commit identity; no adapter/runtime rewrite. A candidate address is validated before production publication workflows and domain changes.

**Budget decision:** Candidate compute is Render `0.5c-512mb`, currently $7/month, Singapore, one instance, automatic deployments/previews off. Other metered resources and taxes are not included in that base quote. Validate runtime memory headroom before recommending activation. Docker daemon is unavailable locally, so Windows RSS/heap measurements cannot prove Linux cgroup compliance.

1. Retain the tested performance commit 7d73f77; isolate all new work from existing dirty workspace.
2. Add Render origin/SHA compatibility without trusting request Host headers or weakening production HTTPS/source checks.
3. Add declarative candidate service and build/start/readiness scripts; verify every ledger receipt dependency and bind the supplied PORT. Preserve strict review and midnight rules.
4. Run targeted correctness/security tests, types, lint, production build and bounded local production HTTP/memory probe. Check first init, sustained/concurrent reads, language/origin/SHA and auth isolation.
5. Document Vercel-only release automation and health coupling explicitly. Keep its existing trust boundaries; a candidate configuration is not full production cutover authorization.
6. Deliver concrete monthly base cost, config, evidence, activation/cutover and rollback steps. Paid service creation, credentials and publication require the final concrete user decision.

**Alternatives:** Workers requires runtime and evidence filesystem adaptation; a VPS offers more control but adds maintenance. Native Render is the smallest deployment-runtime change. If 512MB lacks headroom, report that result instead of silently selecting the $25 instance outside the budget.
