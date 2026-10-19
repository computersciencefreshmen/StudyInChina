"""Bind actual official date reads to exactly the 12 assigned current public cycles."""
import datetime
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
plan_path = root.parent / "current-public-deadline-plan-v1.json"
plan = json.loads(plan_path.read_text(encoding="utf-8"))
primary = Path(plan["inputRoot"])
read = lambda name: json.loads((primary / name).read_text(encoding="utf-8"))
digest = lambda data: hashlib.sha256(data).hexdigest()
for name, expected in plan["inputFileSha256"].items():
    assert digest((primary / "content/data" / name).read_bytes()) == expected, "Canonical snapshot changed"
cycles = {row["id"]: row for row in read("content/data/admission-cycles.json")}
programs = {row["id"]: row for row in read("content/data/programs.json")}
sources = {row["id"]: row for row in read("content/data/sources.json")}
pdfs = {row["key"]: row for row in json.loads((root / "pdf-readable-captures.json").read_text(encoding="utf-8"))}
facts = {
    "uni-beijing-language-and-culture-university": {
        "name": "北京语言大学", "closesOn": "2027-02-01", "opensOn": None,
        "url": pdfs["blcu"]["url"], "pdf": "blcu", "locator": "PDF page 1 programme rows and page 2 报名信息 final deadline line; both pages visually inspected",
        "quote": "春季学期报名截止日期：2027年2月1日", "yearBasis": "explicit deadline year 2027",
        "scope": "2027 international undergraduate table: Chinese Language and International Chinese Education, spring entry",
        "openingDateAssessed": False,
    },
    "uni-shanghai-jiao-tong-university": {
        "name": "上海交通大学", "closesOn": "2027-01-15", "opensOn": None,
        "url": "https://www.oec.sjtu.edu.cn/en/pressreleases/info.aspx?itemid=6157", "locator": "Application Deadline, web lines 228-231; Chinese/English half-year spring registration scope lines 68/97",
        "quote": "TheSpring intake programs: 2027 January 15", "quoteNormalization": "Superscript ordinal marker omitted; spacing otherwise retained from returned web text",
        "yearBasis": "explicit deadline year 2027; page title retains original 2026 programme year",
        "scope": "Chinese and English half-year pre-university transfer routes for February 2027; not fall scholarship deadline",
        "openingDateAssessed": False,
    },
    "uni-xian-jiaotong-university": {
        "name": "西安交通大学", "opensOn": "2026-10-01",
        "url": "https://sie.xjtu.edu.cn/en/info/1165/3212.htm", "locator": "Start Time & Application Deadline table, web lines 117-121",
        "quote": "Advanced Program | February, 2027 | October 1, 2026-January 15, 2027",
        "secondRouteQuote": "Intensive Program | April, 2027 | October 1, 2026-March 12, 2027",
        "yearBasis": "both application years explicitly printed in the table",
        "scope": "Advanced 18-week February 2027 and Intensive 11-week April 2027 IFP routes; basic September route excluded",
        "openingDateAssessed": True,
    },
    "uni-southwest-jiaotong-university": {
        "name": "西南交通大学", "closesOn": "2027-01-01", "opensOn": None,
        "url": "https://sie.swjtu.edu.cn/info/1014/3352.htm", "locator": "一、申请日期 (line 71); 四、申请网站 note (line 110)",
        "quote": "申请春季入学的申请人应在2027年1月1日前完成网上申请", "yearBasis": "explicit deadline year 2027",
        "scope": "2027 spring language learner programme, elementary and intermediate classes",
        "openingDateAssessed": False,
        "deadlineBoundary": "before-date-as-worded", "precisionNote": "Heading says until 2027-01-01, but application-site note says before 2027-01-01. Do not claim a full inclusive day on January 1. No time of day is supplied. Opening is 即日起, not a calendar date.",
    },
    "uni-guangdong-university-of-foreign-studies": {
        "name": "广东外语外贸大学", "closesOn": "2026-12-10", "opensOn": "2026-09-30",
        "url": "https://iie-en.gdufs.edu.cn/info/1174/2795.htm", "locator": "Application Period, web line 46; named Chinese BA and Business Chinese routes line 48",
        "quote": "From September 30 to December 10, 2026", "yearBasis": "explicit application year 2026; Spring Enrollment 2027 notice",
        "scope": "Degree programme spring 2027 admissions; Chinese BA and Chinese (Business Chinese); ICLT routes excluded",
        "openingDateAssessed": True,
    },
    "uni-fudan-university": {
        "name": "复旦大学", "closesOn": "2026-12-13", "opensOn": "2026-10-16",
        "url": pdfs["fudan"]["url"], "pdf": "fudan", "locator": "PDF page 11 Application periods, visually inspected; official landing notice published 2026-10-13",
        "quote": "Applications begin on October16. Deadline of submitting application is December 13.",
        "yearBasis": "Month/day wording contains no year. 2026 is contextual: October 13, 2026 official publication and spring 2027 intake. Preserve this distinction; not a quote of an explicitly printed 2026 deadline.",
        "scope": "2027 spring semester non-degree Chinese Language intake; one-semester public route only",
        "openingDateAssessed": True,
    },
    "uni-shanghai-university": {
        "name": "上海大学", "closesOn": "2026-12-30", "opensOn": "2026-09-30",
        "url": pdfs["shu"]["url"], "pdf": "shu", "locator": "PDF physical page 3 (printed page 2), 二、网上申请（一）申请时间; visually inspected",
        "quote": "2026 年 9 月 30 日至 2026 年 12 月 30 日", "yearBasis": "explicit application year 2026, 2027 spring guide",
        "scope": "International Foundation Programme, spring 2027",
        "openingDateAssessed": True,
    },
}

schools = []
excluded = set(plan["previousBatches"]["excludedRecordIds"])
for recommendation in plan["nextRecommendations"]:
    university_id = recommendation["universityId"]
    fact = facts[university_id]
    record_ids = [record_id for guide in recommendation["guides"] for record_id in guide["cycleIds"]]
    records = []
    for record_id in record_ids:
        assert record_id not in excluded
        row = cycles[record_id]
        if university_id == "uni-xian-jiaotong-university":
            closes = "2027-01-15" if "advanced" in record_id else "2027-03-12"
        else:
            closes = fact["closesOn"]
        assert row["closesOn"] == closes
        if fact["openingDateAssessed"]:
            assert row["opensOn"] == fact["opensOn"]
        records.append({"collection": "admissionCycles", "recordId": record_id, "programId": row["programId"],
                        "programName": programs[row["programId"]]["name"], "academicYear": row["academicYear"], "intake": row["intake"],
                        "storedDeadline": row["closesOn"], "officialDeadline": closes, "storedOpensOn": row["opensOn"],
                        "officialOpensOn": fact["opensOn"] if fact["openingDateAssessed"] else None,
                        "openingDateAssessed": fact["openingDateAssessed"], "result": "unchanged", "publicationBefore": True,
                        "deadlineBoundary": fact.get("deadlineBoundary", "date-only-no-time-stated"), "officialCutoffAt": None,
                        "sourceIds": row["sourceIds"], "evidenceSourceIds": [source_id for source_id in row["sourceIds"] if sources[source_id]["url"] == fact["url"]],
                        "dateOnly": True, "canonicalWritePerformed": False, "fullFactsCertified": False})
        assert records[-1]["evidenceSourceIds"], "Official evidence URL must bind to a canonical cycle source"
    school = {"universityId": university_id, "universityName": fact["name"], "sourceUrl": fact["url"], "result": "unchanged",
              "scope": fact["scope"], "quote": fact["quote"], "evidenceLocator": fact["locator"], "yearBasis": fact["yearBasis"],
              "officialWebsiteRead": True, "rawBytesCaptured": "pdf" in fact, "dateOnly": True, "fullFactsCertified": False,
              "applicationsOpenNow": "portal-acceptance-not-assessed", "recordResults": records}
    for optional in ["secondRouteQuote", "quoteNormalization", "deadlineBoundary", "precisionNote"]:
        if optional in fact:
            school[optional] = fact[optional]
    if "pdf" in fact:
        school["capture"] = pdfs[fact["pdf"]]
    schools.append(school)
assert len(schools) == 7
assert sum(len(school["recordResults"]) for school in schools) == 12
assert len({record["recordId"] for school in schools for record in school["recordResults"]}) == 12
report = {"schemaVersion": 1, "batchId": "official-date-only-008-20261019", "state": "completed-with-precision-caveats",
          "auditDate": "2026-10-19", "timeZone": "Asia/Shanghai", "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "snapshotSha256": plan["snapshotSha256"], "inputFileSha256": plan["inputFileSha256"], "planSha256": digest(plan_path.read_bytes()),
          "selection": "Exactly 12 not-previously-assessed public cycles across seven schools, excluding prior 70 records and fresh release approved 16 programs / 7 scholarships.",
          "acquisition": {"method": "Actual web reads of official HTML plus native HTTPS PDF fetch, local pypdf extraction and rendered-page inspection",
                          "uniqueOfficialUrlsOpened": 9, "officialUrlsSuccessfullyRead": 9, "dateEvidenceSourcesRead": 7,
                          "freshNativePdfSources": 3, "priorApprovedEvidenceReused": 0,
                          "initialPdfWebParserFailures": 3, "initialSandboxNetworkFailure": True,
                          "recoveredBy": "Authorized bounded native fetch, then pypdf and Poppler; no PDF failures remain unresolved",
                          "htmlRawBytesCaptured": False, "webResultFreshness": "Tool results may be cached; observed reads are not origin-server capture timestamps."},
          "summary": {"schoolsAttempted": 7, "recordsAssessed": 12, "recordResults": {"unchanged": 12, "corrected": 0, "closed": 0, "unknown": 0, "blocked": 0},
                      "fullFactsCertified": 0, "wholeSchoolCataloguesCompleted": 0, "canonicalWrites": 0, "paidModelCalls": 0, "publicationActions": 0},
          "precisionIssues": [{"universityId": "uni-southwest-jiaotong-university", "recordId": record_id,
                               "deadlineBoundary": "before-date-as-worded", "officialCutoffAt": None,
                               "notes": facts["uni-southwest-jiaotong-university"]["precisionNote"]}
                              for record_id in ["cycle-swjtu-chinese-elementary-2027-spring", "cycle-swjtu-chinese-intermediate-2027-spring"]],
          "rules": ["Only dates and route/intake scope were reviewed; no other facts or whole-school catalogues are certified.",
                    "Fudan year is contextual, not explicitly repeated alongside the application month/day; raw source wording is retained.",
                    "SWJTU before-date wording overrides any assumption of a full inclusive deadline day.",
                    "No opening date is invented where the guide only states a deadline or says 即日起.",
                    "A closed intake does not mean a discontinued programme. No canonical status, verifiedAt or reviewAfter was changed.",
                    "No current portal acceptance test was performed."], "schools": schools}
(root / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(root / "README.md").write_text("# Official date-only recheck batch 008\n\n12 selected public-cycle deadlines across 7 schools match the official guides. This does not certify any whole-school catalogue or other facts.\n\nActual reads: 9 distinct official URLs, including 3 freshly fetched PDFs. No prior approved evidence was counted as a new read. The BLCU table is image-only: both pages were rendered and visually inspected; its February 1, 2027 spring deadline was transcribed manually. Fudan's October 16–December 13 window uses the contextual preceding year from the October 2026 publication and spring 2027 intake. SWJTU requires online completion before January 1, 2027; the report preserves that boundary for both language routes.\n\n`report.json` binds all 12 exact cycle IDs to source IDs and official dates. Native PDFs, hashes, text, rendered date pages and the image-only table transcription are retained. `pdf-capture-receipts.json` preserves the first extractor error; `pdf-readable-captures.json` records its successful pypdf resolution. HTML evidence is retained as returned web-tool observations, not claimed as raw origin-server captures.\n\nNo canonical, progress, Git or deployment changes were made.\n", encoding="utf-8")
print(json.dumps({"schools": len(schools), "records": 12, "unchanged": 12, "precisionIssues": len(report["precisionIssues"]), "reportSha256": digest((root / "report.json").read_bytes())}, indent=2))
