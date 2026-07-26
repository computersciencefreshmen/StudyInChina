'use client'

import { useMemo, useState } from 'react'

import type { LaunchLocale } from '@/i18n/config'

import styles from './DoubleFirstClassCoverageTable.module.css'

type SourceCategory =
  | 'international_admissions_home'
  | 'catalog_anchor'
  | 'university_scholarship'

export type CoverageInstitution = {
  ordinal: number
  targetId: string
  institutionId: string | null
  nameZh: string
  nameEn: string | null
  region: string | null
  province: string | null
  status: 'source_manifest_complete' | 'reconciled_limited' | 'collecting'
  checkedAt: string | null
  sourceCount: number
  reconciliationCount: number
  sources: Array<{
    category: SourceCategory
    officialUrl: string
    verificationMethod: string
  }>
  categories: Array<{
    category: SourceCategory
    status: 'verified_official' | 'source_unavailable' | 'officially_not_provided' | 'collecting'
    officialUrl: string | null
    evidenceUrl: string | null
    note: string | null
  }>
}

type Copy = {
  search: string
  searchPlaceholder: string
  status: string
  all: string
  complete: string
  limited: string
  collecting: string
  unavailable: string
  notProvided: string
  results: string
  school: string
  location: string
  checked: string
  officialSources: string
  admissions: string
  catalog: string
  scholarship: string
  pending: string
}

const copyByLocale: Record<LaunchLocale, Copy> = {
  zh: {
    search: '搜索学校',
    searchPlaceholder: '中文名、英文名、省份或地区',
    status: '采集状态',
    all: '全部',
    complete: '三类来源已核验',
    limited: '已对账 · 官网有限公开',
    collecting: '采集中',
    unavailable: '来源暂不可用',
    notProvided: '官网未提供',
    results: '所学校',
    school: '学校',
    location: '地区',
    checked: '最近核验',
    officialSources: '官方来源',
    admissions: '国际招生',
    catalog: '项目目录',
    scholarship: '奖学金',
    pending: '来源采集中',
  },
  en: {
    search: 'Search universities',
    searchPlaceholder: 'Name, province, or region',
    status: 'Collection status',
    all: 'All',
    complete: 'Three sources verified',
    limited: 'Reconciled · limited official publication',
    collecting: 'Collecting',
    unavailable: 'Source unavailable',
    notProvided: 'Not officially provided',
    results: 'universities',
    school: 'University',
    location: 'Location',
    checked: 'Last checked',
    officialSources: 'Official sources',
    admissions: 'Admissions',
    catalog: 'Program catalog',
    scholarship: 'Scholarships',
    pending: 'Sources being collected',
  },
  ru: {
    search: 'Поиск вузов',
    searchPlaceholder: 'Название, провинция или регион',
    status: 'Статус сбора',
    all: 'Все',
    complete: 'Три источника проверены',
    limited: 'Сверено · ограниченная публикация',
    collecting: 'Собирается',
    unavailable: 'Источник недоступен',
    notProvided: 'Официально не опубликовано',
    results: 'вузов',
    school: 'Университет',
    location: 'Регион',
    checked: 'Проверено',
    officialSources: 'Официальные источники',
    admissions: 'Приём',
    catalog: 'Программы',
    scholarship: 'Стипендии',
    pending: 'Источники собираются',
  },
  de: {
    search: 'Hochschulen suchen',
    searchPlaceholder: 'Name, Provinz oder Region',
    status: 'Erfassungsstatus',
    all: 'Alle',
    complete: 'Drei Quellen geprüft',
    limited: 'Abgeglichen · begrenzte Veröffentlichung',
    collecting: 'In Erfassung',
    unavailable: 'Quelle nicht verfügbar',
    notProvided: 'Offiziell nicht veröffentlicht',
    results: 'Hochschulen',
    school: 'Hochschule',
    location: 'Region',
    checked: 'Zuletzt geprüft',
    officialSources: 'Offizielle Quellen',
    admissions: 'Zulassung',
    catalog: 'Programme',
    scholarship: 'Stipendien',
    pending: 'Quellen werden erfasst',
  },
  fr: {
    search: 'Rechercher un établissement',
    searchPlaceholder: 'Nom, province ou région',
    status: 'État de collecte',
    all: 'Tous',
    complete: 'Trois sources vérifiées',
    limited: 'Réconcilié · publication officielle limitée',
    collecting: 'En collecte',
    unavailable: 'Source indisponible',
    notProvided: 'Non publié officiellement',
    results: 'établissements',
    school: 'Établissement',
    location: 'Région',
    checked: 'Dernière vérification',
    officialSources: 'Sources officielles',
    admissions: 'Admissions',
    catalog: 'Programmes',
    scholarship: 'Bourses',
    pending: 'Sources en cours de collecte',
  },
  es: {
    search: 'Buscar universidades',
    searchPlaceholder: 'Nombre, provincia o región',
    status: 'Estado de recopilación',
    all: 'Todas',
    complete: 'Tres fuentes verificadas',
    limited: 'Conciliado · publicación oficial limitada',
    collecting: 'Recopilando',
    unavailable: 'Fuente no disponible',
    notProvided: 'No publicado oficialmente',
    results: 'universidades',
    school: 'Universidad',
    location: 'Región',
    checked: 'Última revisión',
    officialSources: 'Fuentes oficiales',
    admissions: 'Admisiones',
    catalog: 'Programas',
    scholarship: 'Becas',
    pending: 'Fuentes en recopilación',
  },
}

const sourceOrder: SourceCategory[] = [
  'international_admissions_home',
  'catalog_anchor',
  'university_scholarship',
]

export function DoubleFirstClassCoverageTable({
  institutions,
  locale,
}: {
  institutions: CoverageInstitution[]
  locale: LaunchLocale
}) {
  const copy = copyByLocale[locale]
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale)
    return institutions.filter((institution) => {
      if (status && institution.status !== status) return false
      if (!normalizedQuery) return true
      return [
        institution.nameZh,
        institution.nameEn,
        institution.province,
        institution.region,
      ].filter(Boolean).some((value) => (
        value!.toLocaleLowerCase(locale).includes(normalizedQuery)
      ))
    })
  }, [institutions, locale, query, status])
  const sourceLabels: Record<SourceCategory, string> = {
    international_admissions_home: copy.admissions,
    catalog_anchor: copy.catalog,
    university_scholarship: copy.scholarship,
  }

  return (
    <>
      <div className={styles.toolbar} role="search">
        <div className={styles.field}>
          <label htmlFor="double-first-class-search">{copy.search}</label>
          <input
            id="double-first-class-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.searchPlaceholder}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="double-first-class-status">{copy.status}</label>
          <select
            id="double-first-class-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{copy.all}</option>
            <option value="source_manifest_complete">{copy.complete}</option>
            <option value="reconciled_limited">{copy.limited}</option>
            <option value="collecting">{copy.collecting}</option>
          </select>
        </div>
      </div>
      <p className={styles.resultCount} aria-live="polite">
        {filtered.length} {copy.results}
      </p>
      <div className={styles.tableShell}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{copy.school}</th>
              <th scope="col">{copy.location}</th>
              <th scope="col">{copy.status}</th>
              <th scope="col">{copy.checked}</th>
              <th scope="col">{copy.officialSources}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((institution) => {
              const categories = new Map(
                institution.categories.map((category) => [category.category, category]),
              )
              const complete = institution.status === 'source_manifest_complete'
              const limited = institution.status === 'reconciled_limited'
              return (
                <tr key={institution.targetId}>
                  <td className={styles.ordinal}>{institution.ordinal}</td>
                  <td>
                    <span className={styles.schoolName}>
                      <strong>{institution.nameZh}</strong>
                      {institution.nameEn ? <span>{institution.nameEn}</span> : null}
                    </span>
                  </td>
                  <td>
                    <span className={styles.location}>
                      {[institution.province, institution.region].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </td>
                  <td>
                    <span className={[
                      styles.status,
                      complete
                        ? styles.statusComplete
                        : limited
                          ? styles.statusLimited
                          : styles.statusCollecting,
                    ].join(' ')}>
                      {complete
                        ? `3/3 · ${copy.complete}`
                        : limited
                          ? `3/3 · ${copy.limited}`
                          : copy.collecting}
                    </span>
                  </td>
                  <td className={styles.checkedAt}>{institution.checkedAt ?? '—'}</td>
                  <td>
                    <span className={styles.sourceLinks}>
                      {sourceOrder.map((category) => {
                        const source = categories.get(category)
                        if (source?.status === 'verified_official' && source.officialUrl) {
                          return (
                            <a
                              key={category}
                              href={source.officialUrl}
                              target="_blank"
                              rel="noreferrer"
                              title={source.note ?? undefined}
                            >
                              {sourceLabels[category]} ↗
                            </a>
                          )
                        }
                        const statusLabel = source?.status === 'officially_not_provided'
                          ? copy.notProvided
                          : source?.status === 'source_unavailable'
                            ? copy.unavailable
                            : copy.pending
                        return source?.evidenceUrl ? (
                          <a
                            className={styles.sourceUnavailable}
                            key={category}
                            href={source.evidenceUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={source.note ?? undefined}
                          >
                            {sourceLabels[category]} · {statusLabel} ↗
                          </a>
                        ) : (
                          <span className={styles.pending} key={category}>
                            {sourceLabels[category]} · {statusLabel}
                          </span>
                        )
                      })}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
