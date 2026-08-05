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

  return <>
    <form
      className={`filter-panel filter-panel--programs ${styles.panel}`}
      role="search"
      aria-label={messages.programs.title}
      action={`/${locale}/programs`}
      method="get"
    >
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
      <div className={styles.actions}>
        <Button type="submit">{text.apply}</Button>
        <LinkButton variant="ghost" href={`/${locale}/programs`}>{messages.common.clear}</LinkButton>
      </div>
    </form>

    <p className="result-count" aria-live="polite">{result.total} {messages.programs.results}</p>
    {result.items.length ? (
      <div className="content-grid">
        {result.items.map(({ program, university, cycle }) => (
          <ProgramCard key={program.id} program={program} university={university} cycle={cycle} locale={locale} messages={messages} today={today} />
        ))}
      </div>
    ) : <div className="empty-box">{messages.programs.noResults}</div>}

    {result.pageCount > 1 ? (
      <nav className={styles.pagination} aria-label={text.pagination}>
        {result.page > 1
          ? <LinkButton variant="ghost" rel="prev" href={programCatalogHref(locale, filters, result.page - 1)}>{text.previous}</LinkButton>
          : <span />}
        <strong>{result.page} / {result.pageCount}</strong>
        {result.page < result.pageCount
          ? <LinkButton variant="ghost" rel="next" href={programCatalogHref(locale, filters, result.page + 1)}>{text.next}</LinkButton>
          : <span />}
      </nav>
    ) : null}
  </>
}
