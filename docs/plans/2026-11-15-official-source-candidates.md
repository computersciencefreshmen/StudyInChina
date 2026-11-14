# Bounded official source candidates

The catalogue already has a capture → document → model → independent review →
publication pipeline. This endpoint fills the acquisition gap when an operator
finds a new official guide that is not in the seed. It adds acquisition work,
never programme facts, school-wide applicability or verified annual conditions.

## Authority and data flow

`POST /source-candidates` uses the maintenance administrator bearer token and a
32 KiB body limit. One request names one current canary university, at most five
distinct credential-free safe URLs, and one to three acquisition categories per
URL. Categories describe what to look for; they are not admissions assertions.

The Worker requires the current complete 295-school scope, exact control
revision/catalogue hash, enabled acquisition, the existing native reconciliation
gate and the background budget gate. The source migration role rejects this
route before database or object access.

School authority follows the current catalogue's **published ACK**, including
its real deployment/stable-proof pins, to its exact 40-character source commit.
Only these four fixed public paths in
`computersciencefreshmen/StudyInChina` are fetched from
`https://raw.githubusercontent.com`: `content/data/universities.json`,
`cities.json`, `sources.json`, and `identity-acceptances.json`. No project or
model credential is attached. Each response is bounded to 2 MiB and 15 seconds;
redirects, incomplete streams, invalid UTF-8/JSON and missing files hold work.
All four files are checked with the real public `selectDiscoveryData` selector.
Raw seed membership alone cannot grant accepted-directory identity.

The accepted university's canonical official URL must equal its enabled,
catalogue-official `catalog_anchor` seed and current enabled source association.
Candidate hosts must be both an **exact enabled approved seed URL hostname**
and in that school's private official hostname family. An arbitrary sibling
subdomain is insufficient. Shared CSC/CUCAS/StudyInChina authorities, generic
suffixes, unsafe hosts, another school's host and ambiguous shared ownership
cannot authorize a candidate.

Immutable raw files and a directory manifest are cached by SHA-256. The cache
pointer also includes the ACK hash: an identity acceptance ledger can change
without changing the raw catalogue hash. Cached files and bindings are rehashed
before use; the public selector still evaluates freshness at request time.
Absent current publication evidence or an unavailable fixed commit holds the
request; there is no fallback to raw 295-school data or mutable Git main.

## Atomic registration and replay

Source identity is the normal SHA-256 of the normalized URL. An existing URL is
a strict no-op, even if disabled, associated with another school, failed, or
protected by unknown model history. It does not acquire an association, new
categories, enabled state, due date or new capture job. Orphan historical
attempt/job/observation rows prevent a deleted source from being recreated.

For new URLs one atomic D1 batch rechecks the exact control, seed/name,
canonical anchor, published ACK, source/history absence and operation event
absence. It inserts only new source rows, one school association, ordinary
queued capture jobs and an append-only event. The source count is bounded at
20,000. The operation does not send Queue messages, fetch a submitted URL,
change record targets or call MiniMax. Ordinary dispatch subsequently selects
the capture jobs under the existing scheduler limits, robots, redirect/SSRF,
model reservations, unknown protections and publication rules.

The immutable R2 object is explicitly a *proposed* registration and says
`requiresCommittedEvent: true`. Only the exact committed event plus read-back,
content-addressed receipt proves success. A lost batch reply is resolved by
that proof, and repeating the exact operation is a no-op. Reusing its ID with
different intent is rejected. A late pause, catalogue/seed/anchor change,
publication change or newly observed history rolls back every candidate.

## Operator invocation after the reviewed version is deployed

Read authenticated `/status` first; copy the actual revision, scope and
catalogue pins into a local JSON file. Use the current accepted directory's
university ID and an already approved exact official hostname:

```json
{
  "operationId": "cup-2027-guide-review-001",
  "expectedRevision": 123,
  "scopeRegistrySha256": "<actual 64-character current scope hash>",
  "inputCatalogSha256": "<actual 64-character current catalogue hash>",
  "universityId": "<actual accepted CUP university ID>",
  "urls": [{
    "url": "https://<exact approved school hostname>/<actual official guide>.pdf",
    "categories": ["current_guide", "university_scholarship"]
  }]
}
```

Run the existing configured client (it supplies authentication without adding
it to the public Git requests):

```text
node --import tsx scripts/automation/catalog-maintenance-client.ts source-candidates <reviewed-body.json>
```

Do not auto-replace failed revision/catalogue pins. Re-read and review them.
Do not treat registration, capture or a model identity candidate as a published
complete programme. Check the ordinary publisher's accepted/held receipt and
stable public ACK separately.

## Verification and runtime boundary

Node/SQLite tests cover bounded creation, strict existing-URL preservation,
unsafe/shared/foreign/ambiguous authority, publication/cache damage, corrupted
or incomplete Git responses, lost replies and late control/history races. The
native workerd test uses actual D1/R2 and the actual shared selector, forces a
stale accepted identity through real `node:crypto` hashing, and checks healthy
commit plus late-pause atomic rollback with zero Queue/model calls.

Production compatibility is `2026-10-24` with no explicit flags. The bundled
local runtime is `1.20260911.1`; the native test reports the date it actually
uses (`2026-09-11`) and does not claim an exact production-date test. The newer
official `1.20261114.1` binary was downloaded only into ignored local test
storage, but Windows application control refused execution; no policy bypass,
dependency/lockfile update or production flag change was made. Cloudflare's
[official 2026-08-04 announcement](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/)
states that Node compatibility, including `node:crypto`, defaults on from that
date. A production inactive-version compile/prepare check remains an additional
deployment check; local native evidence is explicitly bounded to its real date.
