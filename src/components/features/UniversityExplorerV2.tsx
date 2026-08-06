import { Badge, Button, Card, LinkButton, VerificationBadge } from '@/components/ui'
import type { LaunchLocale } from '@/i18n/config'
import type { Messages } from '@/i18n/messages'
import {
  normalizeProgramField,
  programFieldLabel,
  programFieldTaxonomy,
} from '@/lib/data/fields'
import { localize } from '@/lib/data/format'
import { regionLabels } from '@/lib/data/labels'
import {
  universityCatalogHref,
  type UniversityCatalogResult,
} from '@/lib/university-catalog'
import styles from './ProgramExplorerV2.module.css'

type ExplorerLabels = {
  apply: string
  defaultOrder: string
  nameOrder: string
  next: string
  pagination: string
  previous: string
  programsMost: string
  scholarshipsMost: string
  sortBy: string
}

const labels: Record<LaunchLocale, ExplorerLabels> = {
  en: { apply: 'Apply filters', defaultOrder: 'Default order', nameOrder: 'University A–Z', next: 'Next', pagination: 'University catalogue pages', previous: 'Previous', programsMost: 'Most programs', scholarshipsMost: 'Most scholarships', sortBy: 'Sort by' },
  zh: { apply: '应用筛选', defaultOrder: '默认顺序', nameOrder: '大学名称 A–Z', next: '下一页', pagination: '高校目录分页', previous: '上一页', programsMost: '项目数量最多', scholarshipsMost: '奖学金数量最多', sortBy: '排序方式' },
  ru: { apply: 'Применить фильтры', defaultOrder: 'По умолчанию', nameOrder: 'Вуз A–Я', next: 'Далее', pagination: 'Страницы каталога вузов', previous: 'Назад', programsMost: 'Больше всего программ', scholarshipsMost: 'Больше всего стипендий', sortBy: 'Сортировка' },
  de: { apply: 'Filter anwenden', defaultOrder: 'Standardreihenfolge', nameOrder: 'Hochschule A–Z', next: 'Weiter', pagination: 'Hochschulkatalogseiten', previous: 'Zurück', programsMost: 'Meiste Studiengänge', scholarshipsMost: 'Meiste Stipendien', sortBy: 'Sortieren nach' },
  fr: { apply: 'Appliquer les filtres', defaultOrder: 'Ordre par défaut', nameOrder: 'Établissement A–Z', next: 'Suivant', pagination: 'Pages du catalogue des universités', previous: 'Précédent', programsMost: 'Plus de programmes', scholarshipsMost: 'Plus de bourses', sortBy: 'Trier par' },
  es: { apply: 'Aplicar filtros', defaultOrder: 'Orden predeterminado', nameOrder: 'Universidad A–Z', next: 'Siguiente', pagination: 'Páginas del catálogo de universidades', previous: 'Anterior', programsMost: 'Más programas', scholarshipsMost: 'Más becas', sortBy: 'Ordenar por' },
}

function disciplineLabel(value: string, locale: LaunchLocale): string {
  const normalized = normalizeProgramField(value)
  return normalized ? programFieldLabel(normalized, locale) : value
}

export function UniversityExplorerV2({
  result,
  locale,
  messages,
}: {
  result: UniversityCatalogResult
  locale: LaunchLocale
  messages: Messages
}) {
  const text = labels[locale]
  const filters = result.filters

  return <>
    <form
      className={`filter-panel ${styles.panel}`}
      role="search"
      aria-label={messages.universities.title}
      action={`/${locale}/universities`}
      method="get"
    >
      <div className={`field ${styles.search}`}>
        <label htmlFor="university-search">{messages.common.search}</label>
        <input id="university-search" name="q" defaultValue={filters.query} placeholder={messages.universities.searchPlaceholder} />
      </div>
      <div className="field">
        <label htmlFor="university-city">{messages.universities.cityFilter}</label>
        <select id="university-city" name="city" defaultValue={filters.city}>
          <option value="">{messages.common.all}</option>
          {result.cityOptions.map((city) => <option value={city.value} key={city.value}>{localize(city.name, locale)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="university-region">{messages.universities.regionFilter}</label>
        <select id="university-region" name="region" defaultValue={filters.region}>
          <option value="">{messages.common.all}</option>
          {Object.entries(regionLabels(locale)).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="university-discipline">{messages.universities.fieldFilter}</label>
        <select id="university-discipline" name="discipline" defaultValue={filters.discipline}>
          <option value="">{messages.common.all}</option>
          {programFieldTaxonomy(locale).map(({ key, label }) => <option value={key} key={key}>{label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="university-sort">{text.sortBy}</label>
        <select id="university-sort" name="sort" defaultValue={filters.sort}>
          <option value="default">{text.defaultOrder}</option>
          <option value="name">{text.nameOrder}</option>
          <option value="programs-desc">{text.programsMost}</option>
          <option value="scholarships-desc">{text.scholarshipsMost}</option>
        </select>
      </div>
      <div className={styles.actions}>
        <Button type="submit">{text.apply}</Button>
        <LinkButton variant="ghost" href={`/${locale}/universities`}>{messages.common.clear}</LinkButton>
      </div>
    </form>

    <p className="result-count" aria-live="polite">
      {result.total}{result.totalExact ? '' : '+'} {messages.universities.results}
    </p>

    {result.items.length ? (
      <div className="content-grid">
        {result.items.map(({ institution, city, disciplines, programCount, scholarshipCount }) => {
          const region = institution.region ?? city?.region ?? null
          return <Card key={institution.id} className="record-card" accent={institution.featured ? 'vermilion' : 'none'}>
            <div className="record-card__top">
              <Badge tone="blue">{region ? regionLabels(locale)[region] : messages.common.unknown}</Badge>
              <VerificationBadge
                status={institution.status}
                verifiedAt={institution.verifiedAt}
                locale={locale}
                verifiedDateLabel={messages.common.lastVerified}
                labels={{ verified: messages.common.verified, stale: messages.common.stale, draft: messages.common.draft, archived: messages.common.archived }}
              />
            </div>
            <div>
              <h2 className="record-card__title">{localize(institution.name, locale)}</h2>
              {city ? <p className="record-card__place">⌖ {localize(city.name, locale)}</p> : null}
            </div>
            <p className="record-card__summary">{localize(institution.summary, locale)}</p>
            <div className="tag-list">
              {disciplines.slice(0, 3).map((discipline) => (
                <Badge key={discipline} tone="neutral">{disciplineLabel(discipline, locale)}</Badge>
              ))}
            </div>
            <dl className="record-facts">
              <div><dt>{messages.universities.programs}</dt><dd>{programCount}</dd></div>
              <div><dt>{messages.universities.funding}</dt><dd>{scholarshipCount}</dd></div>
            </dl>
            <div className="record-card__actions">
              <LinkButton href={`/${locale}/universities/${institution.slug}`} variant="secondary" size="small">{messages.common.viewDetails}</LinkButton>
              {institution.admissionsUrl
                ? <a className="text-link" href={institution.admissionsUrl} target="_blank" rel="noreferrer">{messages.common.applyOfficial} ↗</a>
                : <a className="text-link" href={institution.officialUrl} target="_blank" rel="noreferrer">{messages.common.officialSource} ↗</a>}
            </div>
          </Card>
        })}
      </div>
    ) : <div className="empty-box">{messages.universities.noResults}</div>}

    {result.pageCount > 1 ? (
      <nav className={styles.pagination} aria-label={text.pagination}>
        {result.page > 1
          ? <LinkButton variant="ghost" rel="prev" href={universityCatalogHref(locale, filters, result.page - 1)}>{text.previous}</LinkButton>
          : <span />}
        <strong>{result.page} / {result.pageCount}</strong>
        {result.page < result.pageCount
          ? <LinkButton variant="ghost" rel="next" href={universityCatalogHref(locale, filters, result.page + 1)}>{text.next}</LinkButton>
          : <span />}
      </nav>
    ) : null}
  </>
}
