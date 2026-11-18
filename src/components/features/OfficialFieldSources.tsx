import type { LaunchLocale } from '@/i18n/config'
import { getFactStatusMessage } from '@/i18n/fact-status'
import { getMessages } from '@/i18n/messages'
import type { FieldMeta } from '@/lib/catalog-api/types'
import { formatDate } from '@/lib/data/format'
import type { DiscoveryMeta } from '@/lib/data/discovery'

const titles = {
  zh: '逐项查看官方依据', en: 'Check the source for each field', ru: 'Источники по каждому полю',
  de: 'Quellen pro Angabe prüfen', fr: 'Consulter la source de chaque information', es: 'Consultar la fuente de cada dato',
}
const durationTerms = {
  en: ['Maximum duration', 'Duration conditions'], zh: ['最长学制', '学制适用条件'],
  ru: ['Максимальный срок', 'Условия срока обучения'], de: ['Höchstdauer', 'Bedingungen zur Dauer'],
  fr: ['Durée maximale', 'Conditions de durée'], es: ['Duración máxima', 'Condiciones de duración'],
}

function labelMap(locale: LaunchLocale): Record<string, string> {
  const { common, programs, scholarships } = getMessages(locale)
  return { teachingLanguages: common.language, durationMonths: common.duration, durationMonthsMax: durationTerms[locale][0],
    durationText: durationTerms[locale][1], opensOn: programs.opens, closesOn: common.deadline, deadline: common.deadline,
    dateStatus: programs.applicationStatus, applyUrl: common.applyOfficial, applicationUrl: common.applyOfficial,
    languageRequirements: common.requirements, languagePolicy: programs.languagePolicy, eligibility: programs.eligibility,
    applicationMaterials: programs.materials, applicationFeeCny: programs.fee, tuitionCny: common.tuition,
    tuitionStatus: common.tuition, tuitionPeriod: common.tuition, tuitionSchedule: common.tuition,
    'coverage.tuition': scholarships.tuition, 'coverage.accommodation': scholarships.accommodation,
    'coverage.insurance': scholarships.insurance, 'coverage.stipendCnyPerMonth': scholarships.stipend,
    campus: programs.campus, curriculum: programs.curriculum, faculty: programs.faculty, qualification: programs.qualification,
    studyMode: programs.studyMode }
}

function fieldEvidence(record: { id: string } | null | undefined): Record<string, FieldMeta> {
  return (record as { discovery?: DiscoveryMeta } | null | undefined)?.discovery?.fieldMeta ?? {}
}

export function OfficialFieldSources({ locale, records }: { locale: LaunchLocale; records: ({ id: string } | null | undefined)[] }) {
  const labels = labelMap(locale), messages = getMessages(locale)
  const rows = records.flatMap(record => Object.entries(fieldEvidence(record)).map(([path, meta]) => ({ recordId: record!.id, path, meta })))
  if (!rows.length) return null
  return <details className="atlas-stack" data-field-sources>
    <summary>{titles[locale]} ({rows.length})</summary>
    <ul className="source-list">{rows.map(({ recordId, path, meta }) =>
      <li key={recordId + ':' + path} data-field-evidence={recordId + ':' + path}>
        <strong>{labels[path] ?? labels[path.split('.').at(-1)!] ?? path}</strong>{' · '}{getFactStatusMessage(locale, meta.status).label}
        {[...new Set([meta.officialUrl, ...(meta.conflictingSources || [])])].map(url =>
          <a key={url} href={url} target="_blank" rel="noreferrer">{url === meta.officialUrl ? meta.sourceTitle : new URL(url).hostname} ↗</a>)}
        {meta.location && <div data-evidence-location={meta.location.kind}>
          {meta.location.kind === 'text' ? <><q>{meta.location.excerpt}</q> <small>{meta.location.unit} [{meta.location.start}, {meta.location.end})</small></>
            : meta.location.kind === 'html' ? <code>{meta.location.path}</code>
            : <small>{meta.location.kind === 'page' ? 'p.' : '§'} {meta.location.number}</small>}
        </div>}
        <small>{messages.common.lastVerified} <time dateTime={meta.checkedAt}>{formatDate(meta.checkedAt.slice(0, 10), locale, '—')}</time></small>
      </li>)}</ul>
  </details>
}
