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
import { formatProgramDuration } from '@/lib/data/duration'
import { getApplicationState, type ApplicationState } from '@/lib/data/admission'
import { isCurrentAdmissionYear, trackMatchesProgram } from '@/lib/data/cycle-scope'
import { degreeLabels, disciplineLabels, languageLabel } from '@/lib/data/labels'
import { getTodayDate, isCurrentVerifiedRecord } from '@/lib/data/freshness'
import { MAX_COMPARE } from '@/lib/favorites'
import { useFavorites } from './useFavorites'
import { FavoriteButton } from './FavoriteButton'
import { CatalogFreshnessNote } from './DataFreshnessPanel'
import { FollowUpdates } from './FollowUpdates'
import type { publicThirdPartyProgram } from '@/lib/third-party-public'
import { consultationLabels, programConsultationHref } from '@/i18n/program-consultation'

type ComparisonItem = {
  program: ProgramRecord
  currentCycle: AdmissionCycleRecord | null
  linkedScholarshipCount: number
}

type ComparisonResponse = ApiEnvelope<{
  items: ComparisonItem[]
  collectedItems?: SavedCollected[]
  aliases?: Record<string, string>
  missingIds: string[]
}>

type SavedCollected = { savedId: string; displayName?: string; record: ReturnType<typeof publicThirdPartyProgram> }
type LoadedComparisonItem = ComparisonItem & { savedId: string; evaluatedForDate?: string }

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
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

async function fetchComparison(ids: string[], signal: AbortSignal, locale: LaunchLocale): Promise<ComparisonResponse> {
  const response = await fetch(
    `/api/v1/programs/compare?view=all&ids=${encodeURIComponent(ids.join(','))}&locale=${locale}`,
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

function durationLabel(program: ProgramRecord, locale: LaunchLocale, messages: Messages) {
  return formatProgramDuration(program, locale, messages.common.months) ?? messages.common.unknown
}

function comparisonFactStatus(
  record: ProgramRecord | AdmissionCycleRecord | null,
  field: string,
  value: unknown,
  today: string,
  evaluatedForDate?: string,
  parentNeedsReview = false,
): FactStatus {
  const meta = record?.fieldMeta[field]
  if (meta && meta.status !== 'known') return meta.status
  // The server has checked the leaf's review period. That proof lasts only for
  // its China calendar day, even if an old response survives a failed refetch.
  const checkedTime = meta ? Date.parse(meta.checkedAt) : NaN
  const checkedDay = Number.isFinite(checkedTime)
    ? /^\d{4}-\d{2}-\d{2}$/.test(meta!.checkedAt) ? meta!.checkedAt
      : new Date(checkedTime + 8 * 3_600_000).toISOString().slice(0, 10)
    : null
  const checkedNotFuture = checkedDay !== null && checkedDay <= today
    && (meta!.checkedAt.length === 10 || checkedTime <= Date.now())
  if (meta && !checkedNotFuture) return 'stale'
  const wholeCurrent = record && !parentNeedsReview && isCurrentVerifiedRecord(record, today) && record.verifiedAt <= today
  const independentLeaf = evaluatedForDate === today && meta?.status === 'known' && checkedNotFuture
  if (!wholeCurrent && !independentLeaf && (record || parentNeedsReview)) return 'stale'
  return value === null || value === undefined || value === '' ? 'officially_not_announced' : 'known'
}

/** API states are snapshots; date fields must be re-evaluated while a tab stays open. */
function currentApplicationState(cycle: AdmissionCycleRecord | null, today: string, evaluatedForDate?: string, parentNeedsReview = false): ApplicationState {
  if (!cycle?.dateStatus) return 'not-announced'
  const known = (field: 'dateStatus' | 'opensOn' | 'closesOn') => comparisonFactStatus(cycle, field, cycle[field], today, evaluatedForDate, parentNeedsReview) === 'known'
  if (!known('dateStatus')) return 'not-announced'
  for (const field of ['opensOn', 'closesOn'] as const) {
    if (cycle[field] && !known(field)) return 'not-announced'
    if (cycle.fieldMeta[field] && ['conflict', 'source_unavailable', 'stale'].includes(cycle.fieldMeta[field].status)) return 'not-announced'
  }
  if (cycle.dateStatus === 'published' && cycle.opensOn && cycle.opensOn <= today && !known('closesOn')) return 'not-announced'
  const permittedDate = (field: 'opensOn' | 'closesOn') => {
    return known(field) ? cycle[field] : null
  }
  return getApplicationState({
    ...cycle,
    dateStatus: cycle.dateStatus,
    opensOn: permittedDate('opensOn'),
    closesOn: permittedDate('closesOn'),
    evidenceBasis: cycle.evidenceBasis ?? undefined,
    notes: cycle.notes ?? undefined,
  }, today)
}

function applicationStateLabel(cycle: AdmissionCycleRecord | null, messages: Messages, today: string, evaluatedForDate?: string, parentNeedsReview = false): string {
  const labels = {
    open: messages.common.openNow,
    upcoming: messages.programs.upcoming,
    closed: messages.programs.applicationsClosed,
    rolling: messages.programs.rolling,
    'dates-published': messages.programs.datePublished,
    'not-announced': messages.programs.notAnnounced,
    'previous-cycle': messages.programs.previousCycle,
  }
  return labels[currentApplicationState(cycle, today, evaluatedForDate, parentNeedsReview)]
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
  const [items, setItems] = useState<LoadedComparisonItem[]>([])
  const [collectedItems, setCollectedItems] = useState<SavedCollected[]>([])
  const [missingIds, setMissingIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const saved = useMemo(
    () => items.filter(({ savedId }) => favorites.includes(savedId)),
    [items, favorites],
  )
  const compared = saved.filter(({ savedId }) => selected.includes(savedId))
  const savedCollected = collectedItems.filter(({ savedId }) => favorites.includes(savedId))
  const comparedCollected = savedCollected.filter(({ savedId }) => selected.includes(savedId))
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
            .map((ids) => fetchComparison(ids, controller.signal, locale)),
        )
        if (controller.signal.aborted) return
        const returnedItems = responses.flatMap((response) => response.data.items.map(item => ({
          ...item, evaluatedForDate: response.meta?.release?.evaluatedForDate,
        })))
        const aliases = Object.assign({}, ...responses.map(r => r.data.aliases || {}))
        const byId = new Map(returnedItems.map((item) => [item.program.id, item]))
        const collected = responses.flatMap(r => r.data.collectedItems || [])
        setCollectedItems(collected)
        setItems(favorites.flatMap(savedId => {
          const item = byId.get(aliases[savedId] || savedId)
          return item ? [{ ...item, savedId }] : []
        }))
        setMissingIds([
          ...invalidIds,
          ...favorites.filter(id => !byId.has(aliases[id] || id) && !collected.some(c => c.savedId === id) && !invalidIds.includes(id)),
        ])
      } catch {
        if (!controller.signal.aborted) setLoadError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [favorites, ready, retryKey, locale])

  const toggleCompare = (id: string) => setSelected((current) => {
    const available = current.filter((item) => favorites.includes(item))
    if (available.includes(id)) return available.filter((item) => item !== id)
    return available.length < MAX_COMPARE ? [...available, id] : available
  })

  if (!ready) return <p aria-live="polite">{copy.loading}</p>
  if (!favorites.length) return <EmptyState title={messages.favorites.empty} description={messages.favorites.localOnly} action={<LinkButton href={`/${locale}/programs`}>{messages.home.explorePrograms}</LinkButton>} />
  if (loadError) return <div className="notice" role="alert"><p>{experience.loadError}</p><Button type="button" variant="secondary" onClick={() => setRetryKey((value) => value + 1)}>{experience.retry}</Button></div>
  if (loading && saved.length === 0 && savedCollected.length === 0) return <p aria-live="polite">{copy.loading}</p>

  return <div className="atlas-stack" style={{ '--atlas-stack-gap': '3rem' } as React.CSSProperties}>
    {saved.length ? <FollowUpdates locale={locale} bulk targets={saved.map(({ program }) => ({ kind: 'program', id: program.id, label: localize(program.name, locale) }))} /> : null}
    <div>
      <CatalogFreshnessNote locale={locale} today={today} />
      <p className="result-count">{copy.limit} {messages.favorites.localOnly}</p>
      <div className="content-grid">
        {saved.map(({ program, currentCycle, savedId }) => <Card key={savedId} className="record-card">
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={selected.includes(savedId)}
              disabled={!selected.includes(savedId) && selected.filter((id) => favorites.includes(id)).length >= MAX_COMPARE}
              onChange={() => toggleCompare(savedId)}
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
            <FavoriteButton programId={savedId} saveLabel={messages.common.save} savedLabel={copy.remove} />
          </div>
        </Card>)}
        {savedCollected.map(({ savedId, record, displayName }) => <Card key={savedId} className="record-card">
          <label className="checkbox-field"><input type="checkbox" checked={selected.includes(savedId)}
            disabled={!selected.includes(savedId) && selected.filter(id => favorites.includes(id)).length >= MAX_COMPARE}
            onChange={() => toggleCompare(savedId)} /><span>{copy.choose}</span></label>
          <h2 className="record-card__title">{displayName || record.name}</h2><p>{record.schoolName} · {record.provider}</p>
          <div className="record-card__actions"><LinkButton href={`/${locale}/programs/${record.id}`} variant="secondary" size="small">{messages.common.viewDetails}</LinkButton>
            <FavoriteButton programId={savedId} saveLabel={messages.common.save} savedLabel={copy.remove} /></div>
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
    {compared.length || comparedCollected.length ? <section>
      <div className="record-card__top">
        <h2>{copy.comparison}</h2>
        <Button className="no-print" variant="ghost" onClick={() => window.print()}>{messages.common.print}</Button>
      </div>
      <div className="compare-grid">
        {comparedCollected.map(({ savedId, record, displayName }) => <Card key={savedId} accent="jade">
          <h3 className="atlas-card__title">{displayName || record.name}</h3>
          <dl className="compare-facts">{[
            [copy.university, record.schoolName], [messages.programs.degree, record.fields.degree], [messages.common.language, record.fields.language],
            [messages.common.duration, record.fields.duration], [messages.common.tuition, record.fields.tuition],
            [messages.programs.applicationStatus, messages.common.unknown], [decision.currentCycle, messages.common.unknown],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || messages.common.unknown}</dd></div>)}</dl>
          <div className="record-card__actions">{safeHttpsUrl(record.sourceUrl) ? <a className="text-link" href={record.sourceUrl} target="_blank" rel="noreferrer">{record.provider} ↗</a> : null}
            <LinkButton href={programConsultationHref(locale, record.id)} variant="secondary" size="small">{consultationLabels[locale]}</LinkButton></div>
        </Card>)}
        {compared.map(({ program, currentCycle, linkedScholarshipCount, evaluatedForDate }) => {
          const programNeedsReview = !isCurrentVerifiedRecord(program, today)
          const cycleNeedsReview = Boolean(currentCycle && !isCurrentVerifiedRecord(currentCycle, today))
          const needsReview = programNeedsReview || cycleNeedsReview
          const programStatus = (field: string, value: unknown) => comparisonFactStatus(program, field, value, today, evaluatedForDate)
          const cycleStatus = (field: string, value: unknown) => comparisonFactStatus(currentCycle, field, value, today, evaluatedForDate, programNeedsReview)
          const currentTuition = currentCycle?.dateStatus !== 'previous-cycle-reference'
            && currentCycle?.tuitionStatus === 'confirmed'
            && cycleStatus('tuitionStatus', currentCycle.tuitionStatus) === 'known'
            && cycleStatus('tuitionPeriod', currentCycle.tuitionPeriod) === 'known'
            ? currentCycle?.tuitionCny : null
          const applicationState = currentApplicationState(currentCycle, today, evaluatedForDate, programNeedsReview)
          const matchingCycle = currentCycle?.programId === program.id
            && isCurrentAdmissionYear(currentCycle.academicYear, today)
            && trackMatchesProgram(currentCycle, program.teachingLanguages)
            && cycleStatus('academicYear', currentCycle.academicYear) === 'known'
            && programStatus('teachingLanguages', program.teachingLanguages?.length ? program.teachingLanguages : null) === 'known'
          const annualRoute = matchingCycle && cycleStatus('applyUrl', currentCycle?.applyUrl) === 'known'
            ? safeHttpsUrl(currentCycle?.applyUrl) : null
          // Preserve the legacy whole-current, unscoped contract. A partial
          // annual/track review can never borrow its parent's application URL.
          const legacyRoute = matchingCycle && !needsReview && !currentCycle?.teachingLanguage && !currentCycle?.applicationRound
            && programStatus('applyUrl', program.applyUrl) === 'known' ? safeHttpsUrl(program.applyUrl) : null
          const applyHref = applicationState === 'open' || applicationState === 'rolling' ? annualRoute ?? legacyRoute : null
          const duration = { ...program, durationMonthsMax: programStatus('durationMonthsMax', program.durationMonthsMax) === 'known' ? program.durationMonthsMax : null }
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
              <div><dt>{messages.common.language}</dt><dd><FactValue locale={locale} status={programStatus('teachingLanguages', program.teachingLanguages?.length ? program.teachingLanguages : null)} value={program.teachingLanguages?.length ? program.teachingLanguages.map((item) => languageLabel(item, locale)).join(', ') : undefined} /></dd></div>
              <div><dt>{messages.common.duration}</dt><dd><FactValue locale={locale} status={programStatus(program.durationText ? 'durationText' : 'durationMonths', program.durationText ?? program.durationMonths)} value={durationLabel(duration, locale, messages)} /></dd></div>
              <div><dt>{messages.programs.applicationStatus}</dt><dd>{needsReview && applicationState === 'not-announced' ? messages.common.stale : applicationStateLabel(currentCycle, messages, today, evaluatedForDate, programNeedsReview)}</dd></div>
              <div><dt>{decision.currentCycle}</dt><dd>{currentCycle?.academicYear ?? messages.common.unknown}</dd></div>
              <div><dt>{messages.common.tuition}</dt><dd><FactValue locale={locale} status={cycleStatus('tuitionCny', currentTuition)} value={currentTuition == null ? undefined : tuitionLabel(currentCycle, locale, messages)} /></dd></div>
              <div><dt>{messages.programs.fee}</dt><dd><FactValue locale={locale} status={cycleStatus('applicationFeeCny', currentCycle?.applicationFeeCny)} value={currentCycle?.applicationFeeCny == null ? undefined : formatCny(currentCycle.applicationFeeCny, locale, messages.common.unknown)} /></dd></div>
              <div><dt>{messages.common.deadline}</dt><dd><FactValue locale={locale} status={cycleStatus('closesOn', currentCycle?.closesOn)} value={currentCycle?.closesOn ? <time dateTime={currentCycle.closesOn}>{formatDate(currentCycle.closesOn, locale, messages.common.unknown)}</time> : undefined} /></dd></div>
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
