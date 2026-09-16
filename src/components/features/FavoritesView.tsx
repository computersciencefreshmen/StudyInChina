'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, EmptyState, LinkButton } from '@/components/ui'
import { FactValue } from '@/components/ui/FactValue'
import type { LaunchLocale } from '@/i18n/config'
import type { Messages } from '@/i18n/messages'
import { getDataTrustCopy } from '@/i18n/data-trust'
import { getDecisionExperienceCopy } from '@/i18n/decision-experience'
import type {
  AdmissionCycleRecord,
  ApiEnvelope,
  FactStatus,
  ProgramRecord,
} from '@/lib/catalog-api/types'
import { formatCny, formatDate, localize } from '@/lib/data/format'
import { getApplicationState, type ApplicationState } from '@/lib/data/admission'
import { degreeLabels, disciplineLabels, languageLabel } from '@/lib/data/labels'
import { getTodayDate, isCurrentVerifiedRecord } from '@/lib/data/freshness'
import { MAX_COMPARE } from '@/lib/favorites'
import { useFavorites } from './useFavorites'
import { FavoriteButton } from './FavoriteButton'
import { CatalogFreshnessNote } from './DataFreshnessPanel'

type ComparisonItem = {
  program: ProgramRecord
  currentCycle: AdmissionCycleRecord | null
  linkedScholarshipCount: number
}

type ComparisonResponse = ApiEnvelope<{
  items: ComparisonItem[]
  missingIds: string[]
}>

type FavoritesExperience = {
  loadError: string
  retry: string
  unavailable: string
  linkedScholarships: string
}

const experienceCopy: Record<LaunchLocale, FavoritesExperience> = {
  en: { loadError: 'Saved program details could not be loaded.', retry: 'Try again', unavailable: 'No longer in the public catalogue', linkedScholarships: 'Related scholarships' },
  zh: { loadError: '暂时无法载入收藏项目详情。', retry: '重新加载', unavailable: '已不在公开目录中', linkedScholarships: '关联奖学金' },
  ru: { loadError: 'Не удалось загрузить данные сохранённых программ.', retry: 'Повторить', unavailable: 'Больше нет в открытом каталоге', linkedScholarships: 'Связанные стипендии' },
  de: { loadError: 'Details zu gespeicherten Studiengängen konnten nicht geladen werden.', retry: 'Erneut versuchen', unavailable: 'Nicht mehr im öffentlichen Katalog', linkedScholarships: 'Verknüpfte Stipendien' },
  fr: { loadError: 'Impossible de charger les programmes enregistrés.', retry: 'Réessayer', unavailable: 'N’est plus dans le catalogue public', linkedScholarships: 'Bourses associées' },
  es: { loadError: 'No se pudieron cargar los programas guardados.', retry: 'Reintentar', unavailable: 'Ya no está en el catálogo público', linkedScholarships: 'Becas relacionadas' },
}

const PROGRAM_ID_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,199}$/u

function batches<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

async function fetchComparison(ids: string[], signal: AbortSignal): Promise<ComparisonResponse> {
  const response = await fetch(
    `/api/v1/programs/compare?ids=${encodeURIComponent(ids.join(','))}`,
    { headers: { Accept: 'application/json' }, cache: 'no-store', signal },
  )
  if (!response.ok) throw new Error(`Comparison request failed with ${response.status}`)
  return await response.json() as ComparisonResponse
}

function tuitionLabel(cycle: AdmissionCycleRecord | null, locale: LaunchLocale, messages: Messages) {
  if (cycle?.tuitionCny == null) return messages.common.unknown
  const periods = {
    program: messages.programs.tuitionProgram,
    semester: messages.programs.tuitionSemester,
    'academic-year': messages.programs.tuitionAcademicYear,
    month: messages.programs.tuitionMonth,
    other: messages.programs.tuitionOther,
  }
  return `${formatCny(cycle.tuitionCny, locale, messages.common.unknown)} / ${periods[cycle.tuitionPeriod || 'other']}`
}

function durationLabel(program: ProgramRecord, messages: Messages) {
  if (!program.durationMonths) return messages.common.unknown
  return program.durationMonthsMax && program.durationMonthsMax !== program.durationMonths
    ? `${program.durationMonths}–${program.durationMonthsMax} ${messages.common.months}`
    : `${program.durationMonths} ${messages.common.months}`
}

function comparisonFactStatus(
  record: ProgramRecord | AdmissionCycleRecord | null,
  field: string,
  value: unknown,
  today: string,
  parentNeedsReview = false,
): FactStatus {
  if (parentNeedsReview || (record && !isCurrentVerifiedRecord(record, today))) return 'stale'
  const status = record?.fieldMeta[field]?.status
  if (status && status !== 'known') return status
  return value === null || value === undefined || value === '' ? 'officially_not_announced' : 'known'
}

/** API states are snapshots; date fields must be re-evaluated while a tab stays open. */
function currentApplicationState(cycle: AdmissionCycleRecord | null, today: string): ApplicationState {
  if (!cycle?.dateStatus) return 'not-announced'
  const unsafeStatuses = new Set(['conflict', 'source_unavailable', 'stale'])
  for (const field of ['dateStatus', 'opensOn', 'closesOn']) {
    const status = cycle.fieldMeta[field]?.status
    if (status && unsafeStatuses.has(status)) return 'not-announced'
  }
  if (cycle.fieldMeta.dateStatus && cycle.fieldMeta.dateStatus.status !== 'known') return 'not-announced'
  const permittedDate = (field: 'opensOn' | 'closesOn') => {
    const meta = cycle.fieldMeta[field]
    return !meta || meta.status === 'known' ? cycle[field] : null
  }
  return getApplicationState({
    ...cycle,
    dateStatus: cycle.dateStatus,
    opensOn: permittedDate('opensOn'),
    closesOn: permittedDate('closesOn'),
    evidenceBasis: cycle.evidenceBasis ?? undefined,
  }, today)
}

function applicationStateLabel(cycle: AdmissionCycleRecord | null, messages: Messages, today: string): string {
  const labels = {
    open: messages.common.openNow,
    upcoming: messages.programs.upcoming,
    closed: messages.programs.applicationsClosed,
    rolling: messages.programs.rolling,
    'dates-published': messages.programs.datePublished,
    'not-announced': messages.programs.notAnnounced,
    'previous-cycle': messages.programs.previousCycle,
  }
  return labels[currentApplicationState(cycle, today)]
}

export function FavoritesView({
  locale,
  messages,
}: {
  locale: LaunchLocale
  messages: Messages
}) {
  const { favorites, ready } = useFavorites()
  const [selected, setSelected] = useState<string[]>([])
  const [items, setItems] = useState<ComparisonItem[]>([])
  const [missingIds, setMissingIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const saved = useMemo(
    () => items.filter(({ program }) => favorites.includes(program.id)),
    [items, favorites],
  )
  const compared = saved.filter(({ program }) => selected.includes(program.id))
  const copy = messages.favorites
  const experience = experienceCopy[locale]
  const trust = getDataTrustCopy(locale)
  const decision = getDecisionExperienceCopy(locale)
  const today = getTodayDate()

  useEffect(() => {
    if (!ready || favorites.length === 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => setRetryKey((value) => value + 1)
    const scheduleMidnight = () => {
      clearTimeout(timer)
      // Admission dates use modern China Standard Time (UTC+08:00), not the viewer's timezone.
      const dayMilliseconds = 86_400_000
      const untilMidnight = dayMilliseconds - ((Date.now() + 8 * 3_600_000) % dayMilliseconds)
      timer = setTimeout(() => {
        refresh()
        scheduleMidnight()
      }, untilMidnight)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      refresh()
      scheduleMidnight()
    }
    scheduleMidnight()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [ready, favorites.length])

  useEffect(() => {
    if (!ready || favorites.length === 0) return
    const controller = new AbortController()

    const load = async () => {
      setLoading(true)
      setLoadError(false)
      const requestableIds = favorites.filter((id) => PROGRAM_ID_PATTERN.test(id))
      const invalidIds = favorites.filter((id) => !PROGRAM_ID_PATTERN.test(id))
      try {
        const responses = await Promise.all(
          batches(requestableIds, MAX_COMPARE)
            .map((ids) => fetchComparison(ids, controller.signal)),
        )
        if (controller.signal.aborted) return
        const returnedItems = responses.flatMap((response) => response.data.items)
        const byId = new Map(returnedItems.map((item) => [item.program.id, item]))
        setItems(favorites.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []))
        setMissingIds([
          ...invalidIds,
          ...favorites.filter((id) => !byId.has(id) && !invalidIds.includes(id)),
        ])
      } catch {
        if (!controller.signal.aborted) setLoadError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [favorites, ready, retryKey])

  const toggleCompare = (id: string) => setSelected((current) => {
    const available = current.filter((item) => favorites.includes(item))
    if (available.includes(id)) return available.filter((item) => item !== id)
    return available.length < MAX_COMPARE ? [...available, id] : available
  })

  if (!ready) return <p aria-live="polite">{copy.loading}</p>
  if (!favorites.length) return <EmptyState title={messages.favorites.empty} description={messages.favorites.localOnly} action={<LinkButton href={`/${locale}/programs`}>{messages.home.explorePrograms}</LinkButton>} />
  if (loadError) return <div className="notice" role="alert"><p>{experience.loadError}</p><Button type="button" variant="secondary" onClick={() => setRetryKey((value) => value + 1)}>{experience.retry}</Button></div>
  if (loading && saved.length === 0) return <p aria-live="polite">{copy.loading}</p>

  return <div className="atlas-stack" style={{ '--atlas-stack-gap': '3rem' } as React.CSSProperties}>
    <div>
      <CatalogFreshnessNote locale={locale} today={today} />
      <p className="result-count">{copy.limit} {messages.favorites.localOnly}</p>
      <div className="content-grid">
        {saved.map(({ program, currentCycle }) => <Card key={program.id} className="record-card">
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={selected.includes(program.id)}
              disabled={!selected.includes(program.id) && selected.filter((id) => favorites.includes(id)).length >= MAX_COMPARE}
              onChange={() => toggleCompare(program.id)}
            />
            <span>{copy.choose}</span>
          </label>
          <h2 className="record-card__title">{localize(program.name, locale)}</h2>
          <p className="record-card__place">{localize(program.university.name, locale)}</p>
          <div className="tag-list">
            <Badge tone={isCurrentVerifiedRecord(program, today) && (!currentCycle || isCurrentVerifiedRecord(currentCycle, today)) ? 'neutral' : 'warning'}>
              {!isCurrentVerifiedRecord(program, today) || (currentCycle && !isCurrentVerifiedRecord(currentCycle, today))
                ? messages.common.stale : applicationStateLabel(currentCycle, messages, today)}
            </Badge>
            <span>{degreeLabels(locale)[program.degreeLevel]}</span>
            <span>{program.discipline ? disciplineLabels(locale)[program.discipline] : messages.common.unknown}</span>
          </div>
          <div className="record-card__actions">
            <LinkButton href={`/${locale}/programs/${program.slug}`} variant="secondary" size="small">{messages.common.viewDetails}</LinkButton>
            <FavoriteButton programId={program.id} saveLabel={messages.common.save} savedLabel={copy.remove} />
          </div>
        </Card>)}
        {missingIds.filter((id) => favorites.includes(id)).map((id) => <Card key={id} className="record-card">
          <h2 className="record-card__title">{experience.unavailable}</h2>
          <p className="record-card__place">{id}</p>
          <div className="record-card__actions">
            <FavoriteButton programId={id} saveLabel={messages.common.save} savedLabel={copy.remove} />
          </div>
        </Card>)}
      </div>
    </div>
    {compared.length ? <section>
      <div className="record-card__top">
        <h2>{copy.comparison}</h2>
        <Button className="no-print" variant="ghost" onClick={() => window.print()}>{messages.common.print}</Button>
      </div>
      <div className="compare-grid">
        {compared.map(({ program, currentCycle, linkedScholarshipCount }) => {
          const programNeedsReview = !isCurrentVerifiedRecord(program, today)
          const cycleNeedsReview = Boolean(currentCycle && !isCurrentVerifiedRecord(currentCycle, today))
          const needsReview = programNeedsReview || cycleNeedsReview
          const currentTuition = currentCycle?.dateStatus !== 'previous-cycle-reference'
            && (currentCycle?.tuitionStatus ?? 'confirmed') === 'confirmed'
            ? currentCycle?.tuitionCny : null
          const applicationState = currentApplicationState(currentCycle, today)
          const canApply = !needsReview
            && comparisonFactStatus(program, 'applyUrl', program.applyUrl, today) === 'known'
            && (applicationState === 'open' || applicationState === 'rolling')
          const applyHref = canApply ? safeHttpsUrl(program.applyUrl) : null
          const sourceHref = currentCycle?.officialSources
            .map((source) => safeHttpsUrl(source.url)).find(Boolean)
            ?? program.officialSources.map((source) => safeHttpsUrl(source.url)).find(Boolean)
            ?? safeHttpsUrl(program.programUrl)
          const reviewDue = [program.reviewAfter, ...(currentCycle ? [currentCycle.reviewAfter] : [])].sort()[0]

          return <Card key={program.id} accent="jade">
            <h3 className="atlas-card__title">{localize(program.name, locale)}</h3>
            <dl className="compare-facts">
              <div><dt>{copy.university}</dt><dd>{localize(program.university.name, locale)}</dd></div>
              <div><dt>{messages.programs.degree}</dt><dd>{degreeLabels(locale)[program.degreeLevel]}</dd></div>
              <div><dt>{messages.common.language}</dt><dd><FactValue locale={locale} status={comparisonFactStatus(program, 'teachingLanguages', program.teachingLanguages?.length ? program.teachingLanguages : null, today)} value={program.teachingLanguages?.length ? program.teachingLanguages.map((item) => languageLabel(item, locale)).join(', ') : undefined} /></dd></div>
              <div><dt>{messages.common.duration}</dt><dd><FactValue locale={locale} status={comparisonFactStatus(program, 'durationMonths', program.durationMonths, today)} value={durationLabel(program, messages)} /></dd></div>
              <div><dt>{messages.programs.applicationStatus}</dt><dd>{needsReview ? messages.common.stale : applicationStateLabel(currentCycle, messages, today)}</dd></div>
              <div><dt>{decision.currentCycle}</dt><dd>{currentCycle?.academicYear ?? messages.common.unknown}</dd></div>
              <div><dt>{messages.common.tuition}</dt><dd><FactValue locale={locale} status={comparisonFactStatus(currentCycle, 'tuitionCny', currentTuition, today, programNeedsReview)} value={currentTuition == null ? undefined : tuitionLabel(currentCycle, locale, messages)} /></dd></div>
              <div><dt>{messages.programs.fee}</dt><dd><FactValue locale={locale} status={comparisonFactStatus(currentCycle, 'applicationFeeCny', currentCycle?.applicationFeeCny, today, programNeedsReview)} value={currentCycle?.applicationFeeCny == null ? undefined : formatCny(currentCycle.applicationFeeCny, locale, messages.common.unknown)} /></dd></div>
              <div><dt>{messages.common.deadline}</dt><dd><FactValue locale={locale} status={comparisonFactStatus(currentCycle, 'closesOn', currentCycle?.closesOn, today, programNeedsReview)} value={currentCycle?.closesOn ? <time dateTime={currentCycle.closesOn}>{formatDate(currentCycle.closesOn, locale, messages.common.unknown)}</time> : undefined} /></dd></div>
              <div><dt>{experience.linkedScholarships}</dt><dd>{linkedScholarshipCount.toLocaleString(locale)}</dd></div>
              <div><dt>{messages.common.lastVerified}</dt><dd><time dateTime={program.verifiedAt}>{formatDate(program.verifiedAt, locale, '—')}</time></dd></div>
              <div><dt>{trust.reviewDue}</dt><dd><time dateTime={reviewDue}>{formatDate(reviewDue, locale, '—')}</time></dd></div>
            </dl>
            <div className="record-card__actions">
              {sourceHref ? <a className="text-link" href={sourceHref} target="_blank" rel="noreferrer">{messages.common.officialSource} ↗</a> : null}
              {applyHref ? <a className="atlas-button atlas-button--primary atlas-button--small" href={applyHref} target="_blank" rel="noreferrer">{messages.common.applyOfficial} ↗</a> : null}
            </div>
          </Card>
        })}
      </div>
    </section> : null}
  </div>
}
