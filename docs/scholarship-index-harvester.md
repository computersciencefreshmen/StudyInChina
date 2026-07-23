# Official scholarship identity harvester

`scripts/ingestion/scholarship-index-harvester.ts` is a deterministic bootstrap
collector for scholarship **identities** published by university-owned official
pages. It does not infer award amounts, application windows, eligibility, or
whether a scholarship is open in the current cycle.

An identity may enter the pipeline only when its name is present in an official
index/list page and the collector can attach a source locator and quote. A
separate scholarship-cycle collector must verify the current-year application
window before the website labels an identity as open.

## Locked official source set

The first source set covers six Double First-Class universities and uses only
exact HTTPS host allowlists:

| Institution | Official index/list pages | Allowed hosts |
| --- | --- | --- |
| Peking University | `https://isd.pku.edu.cn/en/scholarship.php`, CGS Type B, China Studies, language-teacher, and donation program lists under `isd.pku.edu.cn/en/list.php` | `isd.pku.edu.cn` |
| Zhejiang University | `https://iczu.zju.edu.cn/admissions/jxjjz/list.htm` | `iczu.zju.edu.cn`, `zje.zju.edu.cn`, `zibs.zju.edu.cn`, `oc.zju.edu.cn`, `ism.zju.edu.cn` |
| Fudan University | `https://iso.fudan.edu.cn/xsjxj/list.htm` | `iso.fudan.edu.cn` |
| Tsinghua University | `https://yz.tsinghua.edu.cn/en/Financial_Aid/Scholarship_Application.htm`, `https://is.tsinghua.edu.cn/asdfasdf/adm/ns.htm` | `yz.tsinghua.edu.cn`, `is.tsinghua.edu.cn` |
| Shanghai Jiao Tong University | `https://isc.sjtu.edu.cn/cn/content.aspx?flag=82&info_lb=107` | `isc.sjtu.edu.cn` |
| University of Science and Technology of China | `https://ic.ustc.edu.cn/en/admission.php` | `ic.ustc.edu.cn` |

The compact offline gold fixtures are source-shape samples, not raw website
mirrors. As checked on 2026-07-23, they contain 57 deduplicated,
institution-scoped scholarship identities:

| Institution | Verified fixture identities |
| --- | ---: |
| Peking University | 15 |
| Zhejiang University | 13 |
| Fudan University | 8 |
| Tsinghua University | 8 |
| Shanghai Jiao Tong University | 6 |
| University of Science and Technology of China | 7 |
| **Total** | **57** |

An audited live run at `2026-07-23T16:04:32.783Z` fetched all 11 registered
pages successfully and retained 55 identities after removing related-news
links, generic categories, and a truncated Fudan label. The live distribution
was PKU 15, ZJU 12, Fudan 7, Tsinghua 8, SJTU 6, and USTC 7.

The live count may be lower when an official page changes, is unavailable, or
disallows collection. That condition is reported; the collector does not fill
the gap with guessed values.

## Output contract

Each emitted entity has the publication-neutral shape:

```json
{
  "entityKey": "uni-example:scholarship:example-scholarship",
  "entityType": "scholarship",
  "institutionId": "uni-example",
  "nameZh": null,
  "nameEn": "Example Scholarship",
  "schemeType": "university",
  "officialUrl": "https://official.example.edu.cn/scholarship/1",
  "sourceCheckedAt": "2026-07-23T08:00:00.000Z",
  "evidence": {
    "locator": "html:a[1]",
    "quote": "2026 Example Scholarship Application Guide",
    "officialUrl": "https://official.example.edu.cn/scholarships/index.htm",
    "checkedAt": "2026-07-23T08:00:00.000Z"
  }
}
```

`schemeType` is one of `government`, `university`, `language`, `donation`,
`exchange`, `program_specific`, or `other`. Classification is deterministic and
does not affect identity acceptance.

## Collection gates

- Source and candidate links must use HTTPS and exactly match the registered
  host allowlist. Wildcards, IP literals, credentials, non-default ports, HTTP,
  and unregistered redirects are rejected.
- Requests are serial per host. The minimum interval is 5 seconds, including
  robots and redirect requests.
- `robots.txt` is checked before each live source. A matching `Disallow`, HTTP
  401, or HTTP 403 skips the source. HTTP 404/410 means no published robots
  rules. Ambiguous robots failures fail closed.
- HTTP 429 and 5xx responses are retried up to the configured bounded attempt
  count. The collector does not use cookies, CAPTCHA solving, proxy rotation, or
  any 403 bypass.
- Navigation, footer content, generic scholarship categories, policy/guide
  links without a named scheme, annual reviews, result notices, payment
  notices, external links, and non-scholarship programs are excluded.
- A current-year application/admission wrapper may be removed only when the
  remaining title still names a specific scholarship. The original official
  title remains in `evidence.quote`.
- Duplicates are removed by stable institution-scoped entity key. The same
  national scheme at two universities remains two institution availability
  records.

## Commands

Inspect the registered sources without network access:

```powershell
npx tsx scripts/ingestion/scholarship-index-harvester.ts --dry-run
```

Reproduce the 57-identity offline gold run:

```powershell
npx tsx scripts/ingestion/scholarship-index-harvester.ts `
  --input-dir tests/fixtures/scholarship-index `
  --checked-at 2026-07-23T08:00:00.000Z `
  --output .pipeline-build/scholarship-index-fixture.json
```

Run a live check. The default delay is already 5 seconds:

```powershell
npx tsx scripts/ingestion/scholarship-index-harvester.ts `
  --output .pipeline-build/scholarship-index-live.json
```

Run only selected sources:

```powershell
npx tsx scripts/ingestion/scholarship-index-harvester.ts `
  --sources zju-scholarship-index,fudan-new-student-scholarship-index
```

Validate the collector:

```powershell
npx vitest run tests/unit/scholarship-index-harvester.test.ts
npx tsc --noEmit --pretty false
```

The command writes a harvest envelope containing per-source statuses,
institution coverage, the deduplicated verified count, and entities. A source
with `robots_blocked`, `robots_unavailable`, `fetch_failed`, `parse_failed`, or
`fixture_missing` contributes no identities. Downstream import must preserve
that distinction rather than treating a failed source as an empty official
catalog.
