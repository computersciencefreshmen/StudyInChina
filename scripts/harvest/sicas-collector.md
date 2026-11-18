# SICAS public capture

`collectSicasBatch({sources, state, limit, deadlineAt, environment, fetcher})` returns `{records, state, receipts, summary}`. The caller owns checkpoint persistence and publication. The collector never writes a canonical feed, calls an account/application endpoint, fetches an official university for re-verification, or invokes a model.

The production defaults allow 150 total requests (including robots), at most 250, at most two responses in flight, starts at least 750 ms apart on the provider host, a 20-second request timeout, and a nine-minute batch deadline. Robots crawl delay can increase the spacing. Only HTTPS `www.sicas.com.cn` programme URLs are accepted. Legacy sitemap routes are mapped to the `/School/` form observed in the public UI; names and admission fields come from captured HTML, never URL slugs. Redirects are recorded without following them.

Selection interleaves schools and stores a cursor over the deterministic order. Every attempted programme retains a sanitized outcome keyed by its stable `sicas-<programme-id>`. Successful captures are due for refresh after 30 days; 404/410 outcomes after seven days; network/5xx/unsupported-template failures have bounded exponential retry delays. A 403, 429, or challenge stops the provider immediately and persists its cooldown across scheduled runs. No cookies, login, CAPTCHA solution, TLS exception, alternate IP, or browser impersonation is used.

The parser reads only `.sc-info`, current-programme sidebar rows, and the `#require`, `#materials`, `#about-program`, and `#fees` panels. Related programmes and account forms cannot supply current-programme facts. Each returned field includes a literal quote, a selector, its source URL, fetched time, and raw SHA-256 under `fieldEvidence`. CNY tuition is used when explicitly displayed; no currency conversion occurs. Dates and source anomalies are preserved. `official` is always false and `admissionYear` null. Degree stays absent unless explicitly shown in the detail; duration is not degree evidence.

The durable degree repair queue lives at `state.fieldBackfill.degree` and is keyed by programme ID. A quarter of each batch is available to refresh a previously captured page missing its degree. Unused repair or discovery capacity can serve the other queue. The scheduler uses the same school-coverage tiers; within a school it prefers a saved description with an explicit award heading. A refreshed detail can supply the literal level under its own “Degree Awarded” or “Diploma Awarded” heading. Alternative awards and prerequisite-only language stay pending. A detail still missing explicit evidence is due again in 14 days; host and source-specific restrictions apply independently. The provider's listing filter can help discover an identity, but it cannot supply an award. The checkpoint reports the number of existing public records whose degree was restored.

For local diagnostics:

```text
node scripts/harvest/sicas-collector.mjs --sources private-sources.json --state private-state.json --output private-output --limit 5 --max-minutes 1
node --test scripts/harvest/sicas-collector.test.mjs
```

`--sources` accepts an array or `{programs:[...]}` of `ThirdPartyProgram` summaries. The CLI writes `records.json`, `state.json`, `receipts.json`, and `summary.json` to the explicitly chosen private output directory. Do not commit raw diagnostics. Raw gzip capture is opt-in through `SICAS_RAW_DIR`, accepted only below `RUNNER_TEMP`; it is omitted from returned records, state, and receipts. The workflow can omit raw storage entirely. No secret values are read or printed by diagnostics.

The live prototype captured three valid programme pages from five diverse school targets; two source links returned 404. A five-request CLI batch captured three records plus one slow-retry 404 in approximately four seconds. A resumed batch made only one robots request and no duplicate programme requests. These are observed transport and extraction results, not a guarantee that all sitemap entries remain available.
