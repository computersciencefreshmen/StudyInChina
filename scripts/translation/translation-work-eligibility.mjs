import { sourceIsTargetLanguage } from '../../src/lib/program-translation-contract.ts'

const englishWords = new Set(`a an and are as at be been by can could for from have in is it may must of on or per should
  so that the their these this those to was were which who will with would you your applicants application awarded
  degree duration fee granted programme programs qualified requirements semester students study university year`.split(/\s+/u))

// This is a conservative fallback for short English admissions prose that the
// shared language heuristic misses. Leave other scripts and ambiguous prose to
// the normal translation checks.
export function originalAlreadyInLocale(source, locale) {
  if (sourceIsTargetLanguage(source, locale)) return true
  if (locale !== 'en') return false
  const letters = source.match(/\p{L}/gu) ?? []
  if (letters.some(letter => !/[A-Za-z]/u.test(letter))) return false
  if (/^study subjects:\s+[a-z]/iu.test(source.trim())) return true
  const words = source.toLowerCase().match(/[a-z]+/gu) ?? []
  const matched = words.filter(word => englishWords.has(word))
  return words.length >= 5 && new Set(matched).size >= 4 && matched.length / words.length >= 0.25
}

export function isUnchangedTranslation(source, candidate, locale) {
  if (candidate === source) return true
  if (locale !== 'en') return false
  const asText = text => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
  return asText(source) === asText(candidate)
}
