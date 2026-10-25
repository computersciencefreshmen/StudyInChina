import { normalizeEvidenceText } from '../../ingestion/src/rules'

type NameEvidence = { fieldPath: string; quote: string }
type OfficialName = { en?: string; zh?: string }

/** Callers first locate quotes in captured text. A bad locale cannot invalidate a
 * separately proven official name, and cannot be repaired by inventing a name. */
export function retainProvenLocalizedNames<T extends NameEvidence>(value: unknown, evidence: T[]): {
  name: OfficialName; fieldEvidence: T[];
} {
  const name: OfficialName = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const locale of ['en', 'zh'] as const) {
      const candidate = (value as Record<string, unknown>)[locale]
      if (typeof candidate !== 'string' || !candidate.trim() || candidate.length > 240) continue
      const scriptMatches = locale === 'zh' ? /\p{Script=Han}/u.test(candidate)
        : /\p{Script=Latin}/u.test(candidate) && !/\p{Script=Han}/u.test(candidate)
      if (!scriptMatches || /[^\p{Script=Latin}\p{Script=Han}\p{Script=Common}\p{Script=Inherited}]/u.test(candidate)) continue
      if (evidence.some(field => field.fieldPath === `name.${locale}`
        && normalizeEvidenceText(field.quote).includes(normalizeEvidenceText(candidate)))) name[locale] = candidate
    }
  }
  return { name, fieldEvidence: evidence.filter(field => {
    if (!field.fieldPath.startsWith('name.')) return true
    const locale = field.fieldPath.slice(5)
    if (locale !== 'en' && locale !== 'zh') return false
    return Boolean(name[locale] && normalizeEvidenceText(field.quote).includes(normalizeEvidenceText(name[locale]!)))
  }) }
}
