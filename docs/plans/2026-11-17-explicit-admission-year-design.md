# Preserve official admission-year labels

Some official admissions guides declare only a year, such as `2027`. Requiring
`2027-2028` forces the catalogue to invent an academic-year range that the source
never stated. Keep the existing `academicYear` string property for compatibility,
but allow either an exact four-digit admission year or an explicitly stated
consecutive academic-year range. No stored value, programme ID, cycle ID, identity
key, or existing scope hash is normalized or rewritten.

A pure parser in `cycle-scope.ts` supplies bounds for current/future filtering and
the actual spring/autumn intake year. A single year uses that same year for both
seasons. The bounds are comparison values, not a new range claim. Legacy ranges
retain their start-year autumn/end-year spring interpretation.

The format validator is not evidence of admission. Import still requires official
authority, the exact named programme and degree, international scope, independent
review, located source quotes, and an explicit season. Single-year scope evidence
must pair the literal year with the entry season/month; an unrelated application
date or one half of a range is insufficient. Unknown years remain invalid.

The public and coverage gates still require one usable annual/language/round
scope with a known schedule, application route, teaching language, duration,
language requirements and qualification conditions. Tuition is not a core gate.
The public policy changes to v2 so prior membership cursors and saved publication
proofs cannot be replayed under the new projection. API filters retain exact
equality: `2027` and `2027-2028` are distinct.

An additive D1 migration rebuilds only `program_cycles` because its old CHECK
requires a nine-character range. It copies every column verbatim, retains foreign
keys, recreates the existing indexes, and preserves dependent views/triggers.
Existing malformed/nonconsecutive database rows cause atomic failure for review;
the migration never deletes or relabels them. Scholarship cycle formats stay as
they were. No production migration is executed by this change.

Focused verification covers single years and legacy ranges, wrong years/season
and missing source context, consecutive-range rejection, fixed legacy hash
compatibility, field and cycle imports, exact API filters/cursors, D1 adapters,
populated migration round trips, and current coverage without unknown overcount.
This change contains no university data additions, model calls, or publication.
