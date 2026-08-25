# Explainable facts and official-depth wave — 2026-08-25

## Goal

Reduce applicant decision cost without weakening the catalogue's official-source policy. The public catalogue already has broad institution and program identity coverage; the immediate bottleneck is that duration, current tuition, application dates, application routes, requirements, and scholarship scope are often absent or stale.

This wave combines two capabilities:

1. explain why a decision fact is unavailable instead of collapsing every empty value into “Not announced”; and
2. reuse current official university sources to fill several related program facts safely.

## Architecture position

The long-term fact path remains:

`official source → private snapshot → verified field evidence → Pipeline D1 → versioned Release → Catalog API → applicant UI`

The current production frontend still reads the compatible JSON Release. The UI contract introduced here mirrors the Catalog API `FactStatus` type so the later JSON-to-D1 switch does not require another presentation rewrite.

## Fact-state contract

The shared presentation model supports exactly six states:

| State | Applicant meaning | Value policy |
| --- | --- | --- |
| `known` | Confirmed by an in-scope official source | Show the current value |
| `officially_not_announced` | The reviewed official source does not publish the value | Show the reason, never estimate |
| `source_unavailable` | The registered official source could not be checked | Hide any previous value |
| `conflict` | Official sources disagree | Hide the disputed value |
| `stale` | The evidence passed its review date | Hide the old value and request reverification |
| `not_applicable` | The field does not apply to this route | Explain that it is not applicable |

`FactValue` is the common rendering boundary. Program cards use it first for duration, current tuition, deadline, and application fee. Detail and comparison surfaces will consume the same contract as they migrate to API projections.

## Current versus reference tuition

`tuitionStatus: reference` is historical or rule-level context, not a current confirmed fee. It therefore must not:

- match the “tuition known” filter;
- match current tuition price bands;
- participate as a numeric value in current tuition sorting;
- appear as the primary current tuition value in cards, comparison, SEO, or JSON-LD.

Reference records remain useful as recapture leads and can later be shown in a separately labelled historical-reference section with academic year, source, and checked date.

## Official-depth batching

Sources are prioritised by field reuse rather than raw record count. A university-wide 2026/2027 admission guide can safely update several projects only when it explicitly defines the applicable degree level, applicant population, academic year, and fee or requirement scope.

The first research batch targets Zhejiang University, Hunan University of Technology and Business, Hangzhou Dianzi University, Shanghai International Studies University, Anhui University, Chongqing University, Harbin Institute of Technology, Wuhan University, Xi'an Jiaotong University, and high-demand Chinese-language routes. Closed 2026 rounds remain `closed` or historical; no 2027 value is inferred.

## Error handling and release gates

- Missing and unreachable sources remain explicit states, not guessed values.
- Old fees stay unavailable until the current official scope is reverified.
- An application CTA requires a verified program, a current open or rolling cycle, and an official application URL.
- Data importers are idempotent and preserve existing IDs and slugs.
- Targeted unit tests cover all six fact states and reference-fee filtering.
- Full typecheck, lint, data validation, unit tests, production build, and browser tests run before merge and production promotion.

## Success evidence for this wave

- Four high-risk facts on program cards no longer use an unexplained generic unknown label.
- Reference tuition cannot appear in current-fee filters or current numeric ordering.
- At least one official-source batch adds or refreshes duration, application route, requirements, tuition, deadline, or scholarship relationships without manufacturing an open application state.
- The deployed Release SHA matches the merged Git SHA and production HTTP checks pass.
