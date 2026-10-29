/** A programme-only lexical scope check. Callers must still locate the exact
 * quote in saved official bytes and require a separate applicability review. */
export function hasProgramInternationalScopeEvidence(quote: string): boolean {
  const text = quote.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  // Some official HTML separates the first letter of "Non-Chinese" with a
  // formatting span. Normalize that spelling only for classification; never
  // change the quote that is stored or checked against the source.
  const nationality = text.replace(/\bn\s+on(?=[\s\p{Pd}]*chinese\b)/giu, 'non')
  if (/\bnon[\s\p{Pd}]*chinese\s*(?:citizens?(?:hip)?|nationals?|nationality)\b/iu.test(nationality)
    || /\b(?:without|no)\s+chinese\s+(?:citizenship|nationality)\b/iu.test(nationality)
    || /\bnot\s+(?:(?:be|have|hold|possess|of)\s+)?chinese\s+(?:citizens?(?:hip)?|nationals?|nationality)\b/iu.test(nationality)) return true
  // Explicit nationality wording in Chinese is the same admissions audience,
  // including the official variants 非中国籍, 非中国国籍 and 非中国公民. This does not match
  // Chinese-language instruction or the positive phrase 中国籍公民.
  if (/非\s*中\s*国(?:(?:\s*国)?\s*籍|\s*公\s*民)/u.test(nationality)) return true
  // International activities and teaching-language descriptions are not an
  // admissions audience. Retain the existing scope vocabulary elsewhere.
  const audience = text.replace(/\b(?:international\s+(?:internships?|cooperation)|foreign\s+languages?)\b/giu, '')
    .replace(/国际(?:实习|合作)|外国语言|外语/gu, '')
  return /international|foreign|国际|外国|留学/iu.test(audience)
}
