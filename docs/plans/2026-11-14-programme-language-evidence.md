# Programme-specific teaching-language evidence

A real ready candidate cited only `Divisions (Chinese and English Programs)` for
the languages of one named Computer Science programme, with its name in a
different applicability quote. The directory contains both types of programme;
this does not establish the languages of every listed programme. Dual extraction
agreement alone cannot repair that missing semantic relationship.

Use one pure validator at both cloud field extraction and canonical field import.
For the `program.teachingLanguages` leaf, require a single explicit sentence/row
assigning the stated languages to the exact official programme name. A language
inside the programme name itself cannot be counted. Reject mixed headings,
cross-sentence/name borrowing, conditional/negative assertions, mismatched degree
scope and partial selections from an explicitly bilingual language list.
Require one complete period-terminated declarative quote. FAQ questions,
punctuation-free prefixes and multiple-sentence assertions/retractions remain
held, so a question mark or a later denial cannot be discarded during splitting.

The initial implementation conservatively recognizes direct teaching predicates
or instruction-language labels. A common policy is accepted only when the same
quoted statement explicitly names this programme as a member, e.g. `All
undergraduate programmes listed here, including Computer Science and Technology,
are taught in English.` An unnamed all-programmes policy, unsupported prose or an
unstructured table remains held; no membership is inferred from another quote.
This deliberately favors a reviewable hold over guessing broader applicability.

Other leaves retain their existing applicability rules. Annual, degree, intake,
language-track and round checks remain in place. Request payloads, reservation
keys, model calls/counters and unknown evidence are unchanged. The cloud parser
filters a bad leaf; the canonical importer also holds an already-ready old
proposal with `program_teaching_language_scope_unproven`, leaving the ordinary
prepare/held ACK path responsible for consuming it. No D1 proposal is edited and
no prior field receipt or whole-record audit date is renewed by this change.
