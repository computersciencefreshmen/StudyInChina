import { RoundedSelect } from '@/components/ui/RoundedSelect'
import type { LaunchLocale } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import type { University } from '@/lib/data/types'
import { formatDate } from '@/lib/data/format'
import { getTodayDate } from '@/lib/data/freshness'
import {
  rankingEditionLabel, rankingFilterKeys, rankingFilterLabel, rankingFilterOptions, rankingFilterText,
  type RankingFilters,
} from '@/lib/data/rankings'

export function RankingFilterFields({ filters, locale, prefix, allLabel }: {
  filters: RankingFilters; locale: LaunchLocale; prefix: string; allLabel: string
}) {
  return <>
    {rankingFilterKeys.map((key) => <div className="field" key={key}>
      <label htmlFor={`${prefix}-${key}`}>{rankingFilterLabel(key, locale)}</label>
      <RoundedSelect id={`${prefix}-${key}`} name={key} defaultValue={filters[key] ?? ''}>
        <option value="">{allLabel}</option>
        {rankingFilterOptions(locale).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
      </RoundedSelect>
    </div>)}
  </>
}

export function RankingNotice({ locale }: { locale: LaunchLocale }) {
  return <p className="meta-text">{rankingFilterText(locale).notice}</p>
}

export function UniversityRankingLinks({ university, locale }: { university: University; locale: LaunchLocale }) {
  if (!university.rankings?.length) return null
  const copy = getMessages(locale).common
  const today = getTodayDate()
  const latest = [...new Map([...university.rankings].sort((left, right) => left.year - right.year).map((ranking) => [ranking.system, ranking])).values()]
  return <div className="tag-list">
    {latest.map((ranking) => {
      const key = rankingFilterKeys.find((item) => ({ qsRankMax: 'qs', theRankMax: 'the', usNewsRankMax: 'usnews', arwuRankMax: 'arwu' }[item] === ranking.system))!
      return <div key={`${ranking.system}-${ranking.year}`}>
        <a className="text-link" href={ranking.sourceUrl} target="_blank" rel="noreferrer">
          {rankingFilterLabel(key, locale)} {rankingEditionLabel(ranking)}: {ranking.rankLabel} ↗
        </a>
        <small className="meta-text">{copy.lastVerified}: <time dateTime={ranking.checkedAt}>{formatDate(ranking.checkedAt, locale, '—')}</time>{ranking.reviewAfter && ranking.reviewAfter < today ? ` · ${copy.stale}` : ''}</small>
      </div>
    })}
  </div>
}
