# AI matching data readiness — 2026-10-17

Later maintenance note: this report preserves the initial 753-programme/six-university local research snapshot. The subsequent production readback contains 755 programmes across seven universities. See the [dated operational handoff](../operations/national-program-maintenance-2026-10-17.md) for nationwide targets, actual publication checks and remaining coverage; the small change does not establish nationwide matching readiness.

## Scope and decision

This assessment uses the **local working-tree JSON catalogue**, evaluated for the fixed date **2026-10-17 in Asia/Shanghai**. It is not a live production inventory, a release certification, or evidence that the same data is deployed. The working tree contains existing changes; this audit did not edit catalogue data, run ingestion, call a paid model, or deploy anything.

The available evidence supports a bounded first product: **source-backed programme discovery, checks against the requirements that have actually been verified, and an application preparation checklist**. It does not support calibrated admission probabilities, guaranteed eligibility, guaranteed scholarships, or claims of nationwide matching coverage.

The assessment follows the Data `analyze-data-quality` workflow as a scoped check: identify the intended decision and data grain, compare raw and publication-safe populations, inspect the public schema, and state the limits of the resulting claims.

## Local catalogue profile

The counts below use the existing `selectPublishedData(raw, '2026-10-17')` function. They do not redefine which records may be public.

| Collection | Raw local records | Records passing the publication selector |
| --- | ---: | ---: |
| Sources | 2,550 | 690 |
| Cities | 62 | 62 |
| Universities | 272 | 255 |
| Programmes | 2,035 | 753 |
| Admission cycles | 1,624 | 753 |
| Scholarships | 396 | 0 |

Publication requires current verified records, official sources, and surviving parent relationships. Identity-only programmes are excluded by this selector. Admission cycles with a previous-cycle reference or an expired confirmed closing date are excluded. See [publication.ts](../../src/lib/data/publication.ts) and [freshness.ts](../../src/lib/data/freshness.ts).

**Passing the publication selector is not the same as applications being open.** A surviving cycle can have an opening date in the future. Application state must be computed independently using `getApplicationState(cycle, date)`, which distinguishes open, upcoming, rolling, dates-published, not-announced, closed and previous-cycle states. See [admission.ts](../../src/lib/data/admission.ts). Do not call all 753 cycles open applications.

Running the reproduction snippet gives **245 open, 473 upcoming and 35 dates-published** cycles for this local subset on the fixed evaluation date. `dates-published` does not establish that submission is currently open. A cycle obtained from a broader or older dataset can already be closed; its status must be recomputed for the report date rather than inferred from the existence of a cycle or a future academic-year label.

The 753 published programmes belong to only six universities:

| University | Published programmes |
| --- | ---: |
| Xiamen University | 335 |
| Tianjin University | 244 |
| Northwestern Polytechnical University | 90 |
| Nanjing University | 49 |
| Tsinghua University | 34 |
| Tianjin Foreign Studies University | 1 |

There are 346 master's, 352 doctoral, 53 bachelor's and two language programmes in this subset. **University identity coverage and current programme decision coverage are different quantities.** The 255 published university records must not be marketed as 255 universities with complete matchable admissions requirements.

| Property in the 753-programme subset | Count |
| --- | ---: |
| Has a published admission cycle | 753 |
| Has a non-null closing date | 753 |
| Has teaching-language entries | 751 |
| Has a duration | 751 |
| Has an application URL | 752 |
| Has language-requirement entries | 752 |
| Has eligibility prose in details or supplementary details | 751 |
| Has application-materials prose in details or supplementary details | 751 |
| Has the complete `details` object | 0 |
| Distinct eligibility prose arrays | 31 |

The absence of the full `details` object does not mean there is no useful information: the current records carry partial official facts in `supplementaryDetails`. Likewise, a non-empty eligibility or language-requirement array indicates text is available, **not that reviewed, executable matching rules exist**. Many programmes share institution-level or degree-level admission guidance.

All 753 surviving cycles have `dateStatus: published`; 751 belong to academic year 2027–2028 and two to 2026–2027. There are 509 cycles with `tuitionStatus: confirmed` and 244 with `tuitionStatus: reference`. Amounts must retain their billing period and confidence status; reference tuition is not a current-price guarantee.

All 396 raw scholarship records lack a populated `eligibility` array. Their latest local `reviewAfter` is 2026-10-16, so none survive the date-bound publication selector. This finding does not establish that no real scholarships exist; it establishes that this local snapshot cannot support a current scholarship eligibility promise.

## Schema evidence and matching limits

### Useful existing foundations

- [types.ts](../../src/lib/data/types.ts) links programmes to universities and admission cycles to programmes. It defines degree level, discipline, teaching languages, duration, academic year, intake, application dates, fees and billing periods.
- [schema.ts](../../src/lib/data/schema.ts) validates identifiers, source relationships, official programme sources, admission-cycle relationships and review windows.
- [catalog-api/types.ts](../../src/lib/catalog-api/types.ts) defines field states including `known`, `officially_not_announced`, `not_applicable`, `source_unavailable`, `conflict` and `stale`, together with official source links and checked dates.
- [field-meta.ts](../../src/lib/catalog-api/field-meta.ts) and [service.ts](../../src/lib/catalog-api/service.ts) apply source and freshness handling to the public record projection. A matching service should preserve these contracts instead of treating raw historical values as current facts.
- [program-details.ts](../../src/lib/data/program-details.ts) already makes partial approved admissions information visible without inventing an official curriculum.

### Prose is not a typed rule

In the public TypeScript contract, `LanguageRequirement.minimum` is a string. `ProgramDetails.eligibility` and `applicationMaterials` are arrays of localized prose. See [types.ts](../../src/lib/data/types.ts), lines 65–79.

Actual language entries include numeric thresholds, test levels, alternative qualifications and exemptions. Eligibility text can include age on a particular reference date, prior degrees, nationality review, guardian requirements and residence-history exceptions. The Xiamen Digital Media Art record in [programs.json](../../content/data/programs.json) is an example of these compound conditions. A language minimum of `6.0`, an alternative English-medium certificate, and a citizenship-based exemption cannot be evaluated as one simple string comparison.

Do not infer a missing GPA threshold, convert GPA scales without an established equivalence rule, infer nationality from a name or CV, or interpret a general phrase such as “good academic standing” as a numeric cutoff. A missing rule is an unknown condition, not evidence that there is no requirement.

### Normalized rule infrastructure exists, but population is unproven

The D1 catalogue already defines `requirements` with types such as nationality, age, education, GPA, language test and portfolio, comparators, JSON values and applicability metadata. It also defines required documents and scholarship cycles with explicit scopes. See [catalog migration 0002](../../infra/d1/catalog/migrations/0002_programs_scholarships.sql), especially the `requirements` and `scholarship_cycles` tables. The [pipeline domain migration](../../infra/d1/pipeline/migrations/0001_domain.sql) has corresponding structures.

This is a useful architecture foundation. It does not prove the tables are populated, independently reviewed, exposed through a matching API, or complete for a selected intake. This assessment did not query live D1.

The JSON-to-catalogue release builder writes full-detail eligibility as localized text and carries language requirements as a field; it does not establish a complete, typed rule set for the current supplementary-detail population. See [build-release.ts](../../scripts/catalog/build-release.ts), around lines 452–471. Reuse the normalized model where suitable, but audit actual rule coverage before selling eligibility automation.

### Admission probability is unsupported

The inspected public contract contains no applicant-outcome dataset, comparable application pools, programme-level acceptance labels, available supervisor places, or calibrated historical decisions. Meeting a published minimum is not an estimate of selection probability. Preferences, ranking, academic fit and eligibility are separate concepts.

A report may say “meets the checked published requirements,” “does not meet this explicit requirement,” or “requires official confirmation,” with evidence and scope. It must not turn an arbitrary similarity score into an admission probability or present “safe/target/reach” as an empirically validated prediction.

## Recommended bounded matching design

```text
Applicant-entered profile and chosen universities
  → confirmed structured profile
  → current published programme/cycle retrieval
  → deterministic requirement evaluation
  → preference ranking
  → AI explanation with citations
  → application preparation checklist
```

1. Start with one reviewed cohort: selected universities, target degree and intake. If a chosen university has only identity data or insufficient rules, state the coverage gap and provide its official route.
2. Define a reviewed requirement record with its programme/cycle owner, type, comparator, value and units, alternatives/exemptions, applicable reference date, official evidence, checked date and rule version. Preserve AND/OR conditions rather than flattening them into independent thresholds.
3. Use explicit outcomes such as `satisfied`, `not_satisfied`, `unknown` and `needs_official_review`. Unknown data must not silently pass or automatically reject an applicant.
4. Keep hard requirements separate from preference ranking. Discipline interests, city, budget and teaching language can rank options without claiming admission likelihood.
5. Let AI extract a draft profile, explain evidence, ask for missing facts and write action steps. The user confirms extracted facts. The AI must not override the rule result or invent source requirements.
6. Freeze the catalogue release ID, evaluation date, profile version and rule version in each report so a paid result can be reproduced. Clearly label changed or expired information on later visits.
7. Begin with a structured profile form. A full CV upload is optional future work, not a prerequisite for validating willingness to pay. Collect only the information needed for the selected checks and keep raw sensitive documents out of routine logs.
8. Deliver a small shortlist with reasons, explicit requirement checks, unresolved conditions, materials to prepare, dates and official links. The initial paid value is reduced research effort and fewer avoidable mistakes.

Before a paid release, use manually reviewed cases covering test alternatives and exemptions, age reference dates, GPA scales, unknown fields, stale rules and compound nationality conditions. Track false passes, missing-condition handling, citation correctness and checklist usefulness. Without outcome labels, admission-probability accuracy is not an available evaluation metric.

## Read-only reproduction

Run this PowerShell snippet from the repository root. It reads the local JSON files and imports the real publication and application-state functions. It uses a fixed date, does not read environment secrets, and does not call network services or mutate data. A later working-tree change can legitimately change the counts even with the same fixed date.

```powershell
@'
import fs from 'node:fs';
import { selectPublishedData } from './src/lib/data/publication.ts';
import { getApplicationState } from './src/lib/data/admission.ts';

const evaluatedForDate = '2026-10-17';
const files = {
  sources: 'sources',
  cities: 'cities',
  universities: 'universities',
  programs: 'programs',
  admissionCycles: 'admission-cycles',
  scholarships: 'scholarships',
};
const raw = Object.fromEntries(Object.entries(files).map(([key, file]) => [
  key,
  JSON.parse(fs.readFileSync(`content/data/${file}.json`, 'utf8')),
]));
const published = selectPublishedData(raw, evaluatedForDate);
const counts = bundle => Object.fromEntries(
  Object.entries(bundle).map(([key, rows]) => [key, rows.length]),
);
const group = (rows, key) => rows.reduce((result, row) => {
  const value = key(row);
  result[value] = (result[value] || 0) + 1;
  return result;
}, {});
const programProfile = bundle => {
  const programs = bundle.programs;
  const cycleProgramIds = new Set(bundle.admissionCycles.map(c => c.programId));
  return {
    programs: programs.length,
    byDegree: group(programs, p => p.degreeLevel),
    byScope: group(programs, p => p.verificationScope || 'unspecified'),
    withCycle: programs.filter(p => cycleProgramIds.has(p.id)).length,
    withDetails: programs.filter(p => p.details).length,
    withAnyEligibility: programs.filter(p =>
      p.details?.eligibility?.length || p.supplementaryDetails?.eligibility?.length
    ).length,
    withMaterials: programs.filter(p =>
      p.details?.applicationMaterials?.length
        || p.supplementaryDetails?.applicationMaterials?.length
    ).length,
    withLanguageRequirements: programs.filter(p => p.languageRequirements?.length).length,
    withTeachingLanguages: programs.filter(p => p.teachingLanguages?.length).length,
    withApplyUrl: programs.filter(p => p.applyUrl).length,
    withDuration: programs.filter(p => p.durationMonths !== null).length,
  };
};
const byUniversity = group(published.programs, p => p.universityId);
const scholarshipReviewDates = raw.scholarships.map(s => s.reviewAfter).sort();

console.log(JSON.stringify({
  scope: 'Local working-tree JSON only; not production',
  evaluatedForDate,
  timeZone: 'Asia/Shanghai',
  rawCounts: counts(raw),
  publishedCounts: counts(published),
  rawProgramProfile: programProfile(raw),
  publishedProgramProfile: programProfile(published),
  publishedProgramsByUniversity: Object.entries(byUniversity).map(([id, count]) => ({
    id,
    name: published.universities.find(u => u.id === id)?.name.en,
    programs: count,
  })),
  publishedUniqueEligibilitySets: new Set(published.programs.map(p =>
    JSON.stringify(p.details?.eligibility || p.supplementaryDetails?.eligibility || [])
  )).size,
  publishedCycles: {
    count: published.admissionCycles.length,
    byDateStatus: group(published.admissionCycles, c => c.dateStatus),
    byApplicationState: group(published.admissionCycles,
      c => getApplicationState(c, evaluatedForDate)),
    byAcademicYear: group(published.admissionCycles, c => c.academicYear),
    byTuitionStatus: group(published.admissionCycles, c => c.tuitionStatus || 'missing'),
    withClosingDate: published.admissionCycles.filter(c => c.closesOn !== null).length,
  },
  scholarships: {
    rawWithEligibility: raw.scholarships.filter(s => s.eligibility?.length).length,
    publishedWithEligibility: published.scholarships.filter(s => s.eligibility?.length).length,
    latestRawReviewAfter: scholarshipReviewDates.at(-1),
  },
}, null, 2));
'@ | node --import tsx --input-type=module
```
