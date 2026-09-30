import type { LaunchLocale } from '@/i18n/config'
import type { University, UniversityRanking } from './types'
import { getTodayDate } from './freshness'

export const rankingFilterKeys = ['qsRankMax', 'theRankMax', 'usNewsRankMax', 'arwuRankMax'] as const
export type RankingFilterKey = (typeof rankingFilterKeys)[number]
export type RankingFilterValue = '' | 'ranked' | 'unverified' | '100' | '200' | '500' | '1000'
export type RankingFilters = Partial<Record<RankingFilterKey, RankingFilterValue>>
export const rankingFilterValues: ReadonlySet<string> = new Set(['ranked', 'unverified', '100', '200', '500', '1000'])

const systems: Record<RankingFilterKey, UniversityRanking['system']> = {
  qsRankMax: 'qs', theRankMax: 'the', usNewsRankMax: 'usnews', arwuRankMax: 'arwu',
}

export function parseRankingFilters(params: Record<string, string | string[] | undefined>): RankingFilters {
  return Object.fromEntries(rankingFilterKeys.map((key) => {
    const value = params[key]
    return [key, typeof value === 'string' && rankingFilterValues.has(value) ? value : '']
  })) as RankingFilters
}

export function latestUniversityRanking(university: University, system: UniversityRanking['system'], today = getTodayDate()): UniversityRanking | undefined {
  const ranking = university.rankings?.filter((ranking) => ranking.system === system)
    .sort((left, right) => right.year - left.year)[0]
  return ranking && (!ranking.reviewAfter || ranking.reviewAfter >= today) ? ranking : undefined
}

/** Public evidence follows the same newest-edition rule as the filters. */
export function currentUniversityRankings(university: University, today = getTodayDate()): UniversityRanking[] {
  return rankingFilterKeys.flatMap((key) => {
    const ranking = latestUniversityRanking(university, systems[key], today)
    return ranking ? [ranking] : []
  })
}

export function rankingEditionLabel(ranking: UniversityRanking): string {
  return ranking.editionLabel ?? (ranking.system === 'usnews' ? `${ranking.year - 1}–${ranking.year}` : String(ranking.year))
}

/** A rank band is inside a Top N only when the entire band is inside N. */
export function matchesUniversityRankings(university: University, filters: RankingFilters, today = getTodayDate()): boolean {
  return rankingFilterKeys.every((key) => {
    const value = filters[key]
    if (!value) return true
    const ranking = latestUniversityRanking(university, systems[key], today)
    if (value === 'unverified') return !ranking
    if (value === 'ranked') return Boolean(ranking)
    return Boolean(ranking && ranking.rankMax <= Number(value))
  })
}

export function hasRankingFilters(filters: RankingFilters): boolean {
  return rankingFilterKeys.some((key) => Boolean(filters[key]))
}

const text = {
  en: { qs: 'QS world ranking', the: 'THE world ranking', usnews: 'U.S. News global ranking', arwu: 'ShanghaiRanking (ARWU)', ranked: 'Verified ranking available', unverified: 'Ranking not yet verified', notice: 'University rankings apply to linked programs and scholarships. Edition and official source are shown where verified; missing data does not mean unranked.' },
  zh: { qs: 'QS 世界大学排名', the: 'THE 世界大学排名', usnews: 'U.S. News 全球大学排名', arwu: '软科世界大学排名 (ARWU)', ranked: '已核实排名', unverified: '排名尚未核实', notice: '按关联高校的排名筛选项目和奖学金。已核实排名显示版本年份和官方来源；缺失数据不代表未上榜。' },
  ru: { qs: 'Мировой рейтинг QS', the: 'Мировой рейтинг THE', usnews: 'Глобальный рейтинг U.S. News', arwu: 'Шанхайский рейтинг (ARWU)', ranked: 'Рейтинг проверен', unverified: 'Рейтинг ещё не проверен', notice: 'Рейтинги вузов применяются к связанным программам и стипендиям. Для проверенных данных указаны год и официальный источник; отсутствие данных не означает отсутствие в рейтинге.' },
  de: { qs: 'QS-Weltrangliste', the: 'THE-Weltrangliste', usnews: 'U.S. News-Weltrangliste', arwu: 'ShanghaiRanking (ARWU)', ranked: 'Geprüfter Rang verfügbar', unverified: 'Rang noch nicht geprüft', notice: 'Hochschulrankings filtern zugehörige Studiengänge und Stipendien. Geprüfte Ränge zeigen Ausgabe und offizielle Quelle; fehlende Daten bedeuten nicht, dass eine Hochschule nicht gelistet ist.' },
  fr: { qs: 'Classement mondial QS', the: 'Classement mondial THE', usnews: 'Classement mondial U.S. News', arwu: 'Classement de Shanghai (ARWU)', ranked: 'Classement vérifié', unverified: 'Classement non encore vérifié', notice: 'Les classements des universités filtrent les formations et bourses associées. Les données vérifiées indiquent l’année et la source officielle ; une donnée manquante ne signifie pas une absence du classement.' },
  es: { qs: 'Clasificación mundial QS', the: 'Clasificación mundial THE', usnews: 'Clasificación global U.S. News', arwu: 'ShanghaiRanking (ARWU)', ranked: 'Clasificación verificada', unverified: 'Clasificación aún no verificada', notice: 'Las clasificaciones universitarias filtran programas y becas vinculados. Los datos verificados muestran el año y la fuente oficial; la falta de datos no significa que la universidad no esté clasificada.' },
} satisfies Record<LaunchLocale, { qs: string; the: string; usnews: string; arwu: string; ranked: string; unverified: string; notice: string }>

export function rankingFilterText(locale: LaunchLocale) { return text[locale] }
export function rankingFilterLabel(key: RankingFilterKey, locale: LaunchLocale): string {
  return text[locale][systems[key]]
}
export function rankingFilterOptions(locale: LaunchLocale): Array<{ value: RankingFilterValue; label: string }> {
  return [
    ...(['100', '200', '500', '1000'] as const).map((value) => ({ value, label: `Top ${value}` })),
    { value: 'ranked', label: text[locale].ranked },
    { value: 'unverified', label: text[locale].unverified },
  ]
}
