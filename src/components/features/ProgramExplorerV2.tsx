import { Button, LinkButton } from '@/components/ui'
import type { LaunchLocale } from '@/i18n/config'
import type { Messages } from '@/i18n/messages'
import { programFieldTaxonomy } from '@/lib/data/fields'
import { localize } from '@/lib/data/format'
import { degreeLabels, languageLabel } from '@/lib/data/labels'
import {
  programCatalogHref,
  type ProgramCatalogResult,
} from '@/lib/program-catalog'
import {
  CatalogFilterSummary,
  catalogExplorerText,
  type CatalogFilterChip,
} from './CatalogFilterSummary'
import { CatalogPagination } from './CatalogPagination'
import { ProgramCard } from './RecordCards'
import styles from './ProgramExplorerV2.module.css'

const labels: Record<LaunchLocale, {
  apply: string
  defaultOrder: string
  next: string
  pagination: string
  previous: string
  sortBy: string
}> = {
  en: { apply: 'Apply filters', defaultOrder: 'Default order', next: 'Next', pagination: 'Program catalogue pages', previous: 'Previous', sortBy: 'Sort by' },
  zh: { apply: '应用筛选', defaultOrder: '默认顺序', next: '下一页', pagination: '项目目录分页', previous: '上一页', sortBy: '排序方式' },
  ru: { apply: 'Применить фильтры', defaultOrder: 'По умолчанию', next: 'Далее', pagination: 'Страницы каталога программ', previous: 'Назад', sortBy: 'Сортировка' },
  de: { apply: 'Filter anwenden', defaultOrder: 'Standardreihenfolge', next: 'Weiter', pagination: 'Studiengangseiten', previous: 'Zurück', sortBy: 'Sortieren nach' },
  fr: { apply: 'Appliquer les filtres', defaultOrder: 'Ordre par défaut', next: 'Suivant', pagination: 'Pages du catalogue des programmes', previous: 'Précédent', sortBy: 'Trier par' },
  es: { apply: 'Aplicar filtros', defaultOrder: 'Orden predeterminado', next: 'Siguiente', pagination: 'Páginas del catálogo de programas', previous: 'Anterior', sortBy: 'Ordenar por' },
}

type SelectOption = { value: string; label: string }
type ProgramFilterKey =
  | 'query'
  | 'degree'
  | 'discipline'
  | 'language'
  | 'institution'
  | 'city'
  | 'intake'
  | 'applicationState'
  | 'tuition'
  | 'sort'

function selectedLabel(options: SelectOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value
}

export function ProgramExplorerV2({
  result,
  locale,
  messages,
  today,
}: {
  result: ProgramCatalogResult
  locale: LaunchLocale
  messages: Messages
  today: string
}) {
  const text = labels[locale]
  const filters = result.filters
  const controls = catalogExplorerText(locale)
  const degreeOptions = Object.entries(degreeLabels(locale))
    .map(([value, label]) => ({ value, label }))
  const disciplineOptions = programFieldTaxonomy(locale)
    .map(({ key, label }) => ({ value: key, label }))
  const languageOptions = ['Chinese', 'English', 'Bilingual']
    .map((value) => ({ value, label: languageLabel(value, locale) }))
  const universityOptions = result.universityOptions
    .map((option) => ({ value: option.value, label: localize(option.name, locale) }))
  const cityOptions = result.cityOptions
    .map((option) => ({ value: option.value, label: localize(option.name, locale) }))
  const intakeOptions: SelectOption[] = [
    { value: 'spring', label: messages.programs.springIntake },
    { value: 'autumn', label: messages.programs.autumnIntake },
    { value: 'other', label: messages.programs.otherIntake },
  ]
  const statusOptions: SelectOption[] = [
    { value: 'open', label: messages.common.openNow },
    { value: 'upcoming', label: messages.programs.upcoming },
    { value: 'closed', label: messages.programs.applicationsClosed },
    { value: 'not-announced', label: messages.programs.notAnnounced },
  ]
  const tuitionOptions: SelectOption[] = [
    { value: 'known', label: messages.programs.known },
    { value: 'unknown', label: messages.programs.unannounced },
    { value: 'under-20000', label: '≤ ¥20,000' },
    { value: '20000-40000', label: '¥20,001–40,000' },
    { value: 'over-40000', label: '> ¥40,000' },
  ]
  const sortOptions: SelectOption[] = [
    { value: 'default', label: text.defaultOrder },
    { value: 'name', label: `${messages.common.program} A–Z` },
    { value: 'deadline', label: messages.common.deadline },
    { value: 'tuition-asc', label: `${messages.common.tuition} ↑` },
    { value: 'tuition-desc', label: `${messages.common.tuition} ↓` },
  ]
  const chipHref = (key: ProgramFilterKey) => programCatalogHref(locale, {
    ...filters,
    [key]: key === 'sort' ? 'default' : '',
    page: 1,
    cursor: '',
    cursorHistory: [],
    nextCursor: '',
  }, 1)
  const activeFilters: CatalogFilterChip[] = []
  const addFilter = (key: ProgramFilterKey, label: string, value: string) => {
    if (value) activeFilters.push({ key, label, value, href: chipHref(key) })
  }
  addFilter('query', messages.common.search, filters.query)
  addFilter('degree', messages.programs.degree, selectedLabel(degreeOptions, filters.degree))
  addFilter('discipline', messages.programs.discipline, selectedLabel(disciplineOptions, filters.discipline))
  addFilter('language', messages.programs.languageFilter, selectedLabel(languageOptions, filters.language))
  addFilter('institution', messages.programs.university, selectedLabel(universityOptions, filters.institution))
  addFilter('city', messages.common.city, selectedLabel(cityOptions, filters.city))
  addFilter('intake', messages.programs.intake, selectedLabel(intakeOptions, filters.intake))
  addFilter('applicationState', messages.programs.statusFilter, selectedLabel(statusOptions, filters.applicationState))
  addFilter('tuition', messages.programs.tuitionFilter, selectedLabel(tuitionOptions, filters.tuition))
  if (filters.sort !== 'default') addFilter('sort', text.sortBy, selectedLabel(sortOptions, filters.sort))
  const advancedFilterCount = [
    filters.institution,
    filters.city,
    filters.intake,
    filters.applicationState,
    filters.tuition,
    filters.sort === 'default' ? '' : filters.sort,
  ].filter(Boolean).length

  return <>
    <form
      className={`filter-panel filter-panel--programs ${styles.panel}`}
      role="search"
      aria-label={messages.programs.title}
      action={`/${locale}/programs`}
      method="get"
    >
      <div className={styles.primaryGrid}>
      <div className={`field ${styles.search}`}>
        <label htmlFor="program-search">{messages.common.search}</label>
        <input id="program-search" name="q" defaultValue={filters.query} placeholder={messages.programs.searchPlaceholder} />
      </div>
      <div className="field">
        <label htmlFor="program-degree">{messages.programs.degree}</label>
        <select id="program-degree" name="degree" defaultValue={filters.degree}>
          <option value="">{messages.common.all}</option>
          {Object.entries(degreeLabels(locale)).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="program-discipline">{messages.programs.discipline}</label>
        <select id="program-discipline" name="discipline" defaultValue={filters.discipline}>
          <option value="">{messages.common.all}</option>
          {programFieldTaxonomy(locale).map(({ key, label }) => <option value={key} key={key}>{label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="program-language">{messages.programs.languageFilter}</label>
        <select id="program-language" name="language" defaultValue={filters.language}>
          <option value="">{messages.common.all}</option>
          {['Chinese', 'English', 'Bilingual'].map((value) => <option value={value} key={value}>{languageLabel(value, locale)}</option>)}
        </select>
      </div>
      </div>
      <details className={styles.advanced} open={advancedFilterCount > 0}>
        <summary>{controls.advancedFilters}{advancedFilterCount ? ` (${advancedFilterCount})` : ''}</summary>
        <div className={styles.advancedGrid}>
      <div className="field">
        <label htmlFor="program-institution">{messages.programs.university}</label>
        <select id="program-institution" name="institution" defaultValue={filters.institution}>
          <option value="">{messages.common.all}</option>
          {result.universityOptions.map((option) => <option value={option.value} key={option.value}>{localize(option.name, locale)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="program-city">{messages.common.city}</label>
        <select id="program-city" name="city" defaultValue={filters.city}>
          <option value="">{messages.common.all}</option>
          {result.cityOptions.map((option) => <option value={option.value} key={option.value}>{localize(option.name, locale)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="program-intake">{messages.programs.intake}</label>
        <select id="program-intake" name="intake" defaultValue={filters.intake}>
          <option value="">{messages.common.all}</option>
          <option value="spring">{messages.programs.springIntake}</option>
          <option value="autumn">{messages.programs.autumnIntake}</option>
          <option value="other">{messages.programs.otherIntake}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="program-status">{messages.programs.statusFilter}</label>
        <select id="program-status" name="applicationState" defaultValue={filters.applicationState}>
          <option value="">{messages.common.all}</option>
          <option value="open">{messages.common.openNow}</option>
          <option value="upcoming">{messages.programs.upcoming}</option>
          <option value="closed">{messages.programs.applicationsClosed}</option>
          <option value="not-announced">{messages.programs.notAnnounced}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="program-tuition">{messages.programs.tuitionFilter}</label>
        <select id="program-tuition" name="tuition" defaultValue={filters.tuition}>
          <option value="">{messages.common.all}</option>
          <option value="known">{messages.programs.known}</option>
          <option value="unknown">{messages.programs.unannounced}</option>
          <option value="under-20000">≤ ¥20,000</option>
          <option value="20000-40000">¥20,001–40,000</option>
          <option value="over-40000">&gt; ¥40,000</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="program-sort">{text.sortBy}</label>
        <select id="program-sort" name="sort" defaultValue={filters.sort}>
          <option value="default">{text.defaultOrder}</option>
          <option value="name">{messages.common.program} A–Z</option>
          <option value="deadline">{messages.common.deadline}</option>
          <option value="tuition-asc">{messages.common.tuition} ↑</option>
          <option value="tuition-desc">{messages.common.tuition} ↓</option>
        </select>
      </div>
        </div>
      </details>
      <div className={styles.actions}>
        <Button type="submit">{text.apply}</Button>
        <LinkButton variant="ghost" href={`/${locale}/programs`}>{messages.common.clear}</LinkButton>
      </div>
    </form>

    <CatalogFilterSummary
      activeFilters={activeFilters}
      clearAllHref={`/${locale}/programs`}
      clearAllLabel={messages.common.clear}
      itemCount={result.items.length}
      page={result.page}
      pageSize={result.pageSize}
      resultLabel={messages.programs.results}
      text={controls}
      total={result.total}
      totalExact={result.totalExact}
    />
    <CatalogPagination
      ariaLabel={text.pagination}
      nextHref={result.page < result.pageCount
        ? programCatalogHref(locale, filters, result.page + 1)
        : undefined}
      nextLabel={text.next}
      page={result.page}
      pageCount={result.pageCount}
      position="top"
      previousHref={result.page > 1 && filters.cursorHistory.length > 0
        ? programCatalogHref(locale, filters, result.page - 1)
        : undefined}
      previousLabel={text.previous}
      text={controls}
    />
    {result.items.length ? (
      <div className="content-grid">
        {result.items.map(({ program, university, cycle }) => (
          <ProgramCard key={program.id} program={program} university={university} cycle={cycle} locale={locale} messages={messages} today={today} />
        ))}
      </div>
    ) : <div className="empty-box">{messages.programs.noResults}</div>}

    <CatalogPagination
      ariaLabel={text.pagination}
      nextHref={result.page < result.pageCount
        ? programCatalogHref(locale, filters, result.page + 1)
        : undefined}
      nextLabel={text.next}
      page={result.page}
      pageCount={result.pageCount}
      position="bottom"
      previousHref={result.page > 1 && filters.cursorHistory.length > 0
        ? programCatalogHref(locale, filters, result.page - 1)
        : undefined}
      previousLabel={text.previous}
      text={controls}
    />
  </>
}
