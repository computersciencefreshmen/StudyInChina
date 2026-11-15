# Keep document selection within D1's parameter limit

The official PDF workflow first requests a bounded list of captured documents,
then downloads immutable bytes, runs Poppler/OCR and posts checksum-bound text.
At 225 canary schools, listing expanded the school membership into 225 `?`
parameters plus the limit. D1's [100-parameter statement limit](https://developers.cloudflare.com/d1/platform/limits/)
therefore stopped this first request before PDF download or parsing began.

Observed failures on main `3d7a4feaf103a282c5ed9dc19657d872713cd90d`:

- Run `43664069458`, job `132659472152`, 01:40:37Z: tools installed;
  `Process at most five checksum-bound official documents` failed in under one
  second with the deliberately redacted client error `maintenance_request_failed`.
- Run `43664913426`, job `132662035354`, 01:51:33Z: same step and error.
- A read-only 02:01Z check found control revision 54 with 225 schools,
  `/documents?limit=5` HTTP 409 and original SELECT `EXPLAIN` HTTP 400/code 7500:
  `too many SQL variables at offset 876: SQLITE_ERROR` (226 bindings).

The fix passes the exact school array as one JSON string and uses
`x.university_id IN(SELECT value FROM json_each(?))`. Nonempty sets now need two
bindings; the existing empty-list meaning omits membership filtering and needs
only the limit binding. Source/school association checks, enabled sources,
current raw/snapshot, pending observation, absence of exact-byte derivative or
held failure, ordering, limit and snapshot/PDF validation are unchanged. This
does not change parser tools, capture dates, stored outcomes or model behavior.

At 02:08Z, the fixed 225-school query compiled on the actual target D1 with two
bindings (HTTP 200, zero rows read/written). Its bounded SELECT returned five
rows identical to the equivalent original school-set query with validated ID
literals. Every selected source had a current canary association. These
diagnostic SELECTs wrote zero rows and called no models. They were not a query
cost benchmark or proof that those five PDFs had been parsed successfully.

Local tests use real SQLite plus native workerd D1/R2 for 225, 295 and empty
sets, an older outside-school source, shared-source deduplication, limit and
unchanged control. Further fixtures retain disabled/missing/pending,
already-derived/failed and snapshot source/raw/PDF exclusions. Existing PDF
tests retain checksums, full-page ordering, encryption and OCR bounds.

Private live evidence is retained under the Growth worktree's ignored
`.tmp/account-migration-target/documents-binding-audit-20261115/`. No credentials
or document/model content are included in this change. A successful normal
post-deployment PDF workflow remains the operational verification; the code fix
and a green test suite alone do not establish end-to-end pipeline health.

CI run `43700069343` later failed during native fixture loading on an internal
Miniflare synchronous-proxy message-ID assertion, before the production document
selector ran. The same code and fixture had passed two earlier complete CI runs;
the underlying bridge instability remains unproven. Fixture loading now uses
multirow inserts bounded to 100 bindings and eight statements per awaited batch.
No retry, assertion removal, timeout increase or production change accompanies
this test-only adjustment.
