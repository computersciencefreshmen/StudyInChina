import { sourceIsTargetLanguage } from '../../src/lib/program-translation-contract.ts'

const englishWords = new Set(`a an and are as at be been by can could for from have in is it may must of on or per should
  so that the their these this those to was were which who will with would you your applicants application awarded
  degree duration fee granted programme programs qualified requirements semester students study university year`.split(/\s+/u))
const latinLanguageSignals = [
  'aufenthalt bewerber bewerbung bewerbungsunterlagen bitte einreichen gebühren müssen nachweis sind studiengang studiengebühren unterlagen und',
  'admis bourse candidature doivent dossier diplômés enseignement études frais les licence physique pièces soumettre veuillez',
  'admisión becas cursar deben del enseñanza estudios matrícula precisan presentar requisitos solicitud solicitantes',
].map(words => new Set(words.split(' ')))
const distinctiveLatinWords = new Set(`abitur aufnahme bachelorabschluss bewerbungsfrist deutschkenntnisse hochschulabschluss
  maschinenbau schulabschluss studiengebühr zulassung baccalauréat diplôme français informatique ingénierie
  bachillerato ciudadanía español física ingeniería licenciatura título`.split(/\s+/u))
const shortEnglishAdmissions = /\b(?:high school (?:graduate|graduation|education|diploma)|non[- ]chinese (?:citizen|national|resident)|bachelor(?:'s)? degree|english proficien(?:cy|t)|application (?:procedure|deadline)|with age \d+ through \d+)\b/iu
const attachmentName = /\p{Script=Han}+(?:[ \t]+[a-z][a-z\d' -]{0,96})?\.(?:pdf|docx?|xlsx?|pptx?|zip)(?=$|[\s.,;!?()]|\d+\))/giu

// This is a conservative fallback for short English admissions prose that the
// shared language heuristic misses. Leave other scripts and ambiguous prose to
// the normal translation checks.
export function originalAlreadyInLocale(source, locale) {
  if (sourceIsTargetLanguage(source, locale)) return true
  if (locale !== 'en') return false
  const letters = source.match(/\p{L}/gu) ?? []
  if (letters.some(letter => !/[A-Za-z]/u.test(letter))) return false
  if (shortEnglishAdmissions.test(source)) return true
  if (/^study subjects:\s+[a-z]/iu.test(source.trim())) return true
  const words = source.toLowerCase().match(/[a-z]+/gu) ?? []
  const matched = words.filter(word => englishWords.has(word))
  return words.length >= 5 && new Set(matched).size >= 4 && matched.length / words.length >= 0.25
}

// Short Latin-script titles and requirements are often already English. Keep
// the source as the fallback when nothing positively identifies another language.
export function needsEnglishTranslation(source) {
  // Preserve link destinations and the exact names of downloadable forms.
  const prose = source.replace(/(?:https?:\/\/|www\.)\S+|[^\s@]+@[^\s@]+\.[^\s@]+/giu, ' ').replace(attachmentName, ' ')
  if (/\p{Script=Han}/u.test(prose)) return true
  const letters = prose.match(/\p{L}/gu) ?? []
  if (letters.filter(letter => !/\p{Script=Latin}/u.test(letter)).length >= 2) return true
  const words = new Set(prose.normalize('NFKC').toLowerCase().match(/\p{L}+/gu) ?? [])
  if ([...words].some(word => distinctiveLatinWords.has(word))) return true
  return latinLanguageSignals.some(signals => [...words].filter(word => signals.has(word)).length >= 2)
}

export function isUnchangedTranslation(source, candidate, locale) {
  if (candidate === source) return true
  if (locale !== 'en') return false
  // An English candidate that only re-punctuates the original adds no translation.
  const asText = text => text.normalize('NFKC').toLowerCase().replace(/[\p{P}\s]+/gu, ' ').trim()
  return asText(source) === asText(candidate)
}
