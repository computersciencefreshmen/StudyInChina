import { Button, LinkButton } from '@/components/ui'
import type { LaunchLocale } from '@/i18n/config'
import type { Messages } from '@/i18n/messages'
import { localize } from '@/lib/data/format'
import { degreeLabels } from '@/lib/data/labels'
import {
  scholarshipCatalogHref,
  type ScholarshipCatalogResult,
} from '@/lib/scholarship-catalog'
import { ScholarshipCard } from './ScholarshipCard'
import styles from './ScholarshipExplorerV2.module.css'

type ExplorerLabels = {
  apply: string
  deadline: string
  deadlineAnnounced: string
  deadlineClosed: string
  deadlineFuture: string
  deadlineNext30: string
  deadlineNext90: string
  deadlineUnknown: string
  defaultOrder: string
  degree: string
  funding: string
  fundingAccommodation: string
  fundingFullTuition: string
  fundingInsurance: string
  fundingPartialTuition: string
  fundingStipend: string
  next: string
  noResults: string
  pagination: string
  previous: string
  results: string
  scholarshipName: string
  school: string
  searchPlaceholder: string
  sortBy: string
  stipendHigh: string
}

const labels: Record<LaunchLocale, ExplorerLabels> = {
  en: { apply: 'Apply filters', deadline: 'Deadline', deadlineAnnounced: 'Deadline announced', deadlineClosed: 'Recently closed', deadlineFuture: 'Future deadline', deadlineNext30: 'Next 30 days', deadlineNext90: 'Next 90 days', deadlineUnknown: 'Not announced', defaultOrder: 'Default order', degree: 'Linked degree level', funding: 'Funding', fundingAccommodation: 'Accommodation covered', fundingFullTuition: 'Full tuition', fundingInsurance: 'Insurance covered', fundingPartialTuition: 'Partial tuition', fundingStipend: 'Monthly stipend', next: 'Next', noResults: 'No scholarships match these filters.', pagination: 'Scholarship catalogue pages', previous: 'Previous', results: 'scholarships', scholarshipName: 'Scholarship A–Z', school: 'University', searchPlaceholder: 'Search scholarship or university', sortBy: 'Sort by', stipendHigh: 'Highest stipend' },
  zh: { apply: '应用筛选', deadline: '截止日期', deadlineAnnounced: '已公布截止日期', deadlineClosed: '近期已截止', deadlineFuture: '未来截止', deadlineNext30: '未来 30 天', deadlineNext90: '未来 90 天', deadlineUnknown: '尚未公布', defaultOrder: '默认顺序', degree: '关联学历层次', funding: '资助类型', fundingAccommodation: '包含住宿', fundingFullTuition: '全额学费', fundingInsurance: '包含保险', fundingPartialTuition: '部分学费', fundingStipend: '每月生活费', next: '下一页', noResults: '没有奖学金符合这些筛选条件。', pagination: '奖学金目录分页', previous: '上一页', results: '个奖学金', scholarshipName: '奖学金名称 A–Z', school: '大学', searchPlaceholder: '搜索奖学金或大学', sortBy: '排序方式', stipendHigh: '生活费从高到低' },
  ru: { apply: 'Применить фильтры', deadline: 'Срок подачи', deadlineAnnounced: 'Срок объявлен', deadlineClosed: 'Недавно закрытые', deadlineFuture: 'Будущий срок', deadlineNext30: 'Следующие 30 дней', deadlineNext90: 'Следующие 90 дней', deadlineUnknown: 'Не объявлено', defaultOrder: 'По умолчанию', degree: 'Связанный уровень', funding: 'Финансирование', fundingAccommodation: 'Проживание', fundingFullTuition: 'Полная оплата обучения', fundingInsurance: 'Страховка', fundingPartialTuition: 'Частичная оплата', fundingStipend: 'Ежемесячная выплата', next: 'Далее', noResults: 'Нет стипендий по выбранным фильтрам.', pagination: 'Страницы каталога стипендий', previous: 'Назад', results: 'стипендий', scholarshipName: 'Название A–Я', school: 'Университет', searchPlaceholder: 'Найти стипендию или вуз', sortBy: 'Сортировка', stipendHigh: 'Наибольшая выплата' },
  de: { apply: 'Filter anwenden', deadline: 'Bewerbungsfrist', deadlineAnnounced: 'Frist veröffentlicht', deadlineClosed: 'Kürzlich geschlossen', deadlineFuture: 'Künftige Frist', deadlineNext30: 'Nächste 30 Tage', deadlineNext90: 'Nächste 90 Tage', deadlineUnknown: 'Nicht bekannt gegeben', defaultOrder: 'Standardreihenfolge', degree: 'Verknüpfter Abschluss', funding: 'Förderung', fundingAccommodation: 'Unterkunft abgedeckt', fundingFullTuition: 'Volle Studiengebühren', fundingInsurance: 'Versicherung abgedeckt', fundingPartialTuition: 'Teilweise Studiengebühren', fundingStipend: 'Monatlicher Zuschuss', next: 'Weiter', noResults: 'Keine Stipendien entsprechen diesen Filtern.', pagination: 'Seiten des Stipendienkatalogs', previous: 'Zurück', results: 'Stipendien', scholarshipName: 'Stipendium A–Z', school: 'Universität', searchPlaceholder: 'Stipendium oder Universität suchen', sortBy: 'Sortieren nach', stipendHigh: 'Höchster Zuschuss' },
  fr: { apply: 'Appliquer les filtres', deadline: 'Date limite', deadlineAnnounced: 'Date limite publiée', deadlineClosed: 'Récemment clôturées', deadlineFuture: 'Date limite future', deadlineNext30: '30 prochains jours', deadlineNext90: '90 prochains jours', deadlineUnknown: 'Non annoncée', defaultOrder: 'Ordre par défaut', degree: 'Niveau associé', funding: 'Financement', fundingAccommodation: 'Hébergement couvert', fundingFullTuition: 'Frais complets', fundingInsurance: 'Assurance couverte', fundingPartialTuition: 'Frais partiels', fundingStipend: 'Allocation mensuelle', next: 'Suivant', noResults: 'Aucune bourse ne correspond à ces filtres.', pagination: 'Pages du catalogue des bourses', previous: 'Précédent', results: 'bourses', scholarshipName: 'Bourse A–Z', school: 'Université', searchPlaceholder: 'Rechercher une bourse ou université', sortBy: 'Trier par', stipendHigh: 'Allocation la plus élevée' },
  es: { apply: 'Aplicar filtros', deadline: 'Fecha límite', deadlineAnnounced: 'Fecha publicada', deadlineClosed: 'Cerradas recientemente', deadlineFuture: 'Fecha futura', deadlineNext30: 'Próximos 30 días', deadlineNext90: 'Próximos 90 días', deadlineUnknown: 'No anunciada', defaultOrder: 'Orden predeterminado', degree: 'Nivel vinculado', funding: 'Financiación', fundingAccommodation: 'Alojamiento cubierto', fundingFullTuition: 'Matrícula completa', fundingInsurance: 'Seguro cubierto', fundingPartialTuition: 'Matrícula parcial', fundingStipend: 'Estipendio mensual', next: 'Siguiente', noResults: 'Ninguna beca coincide con estos filtros.', pagination: 'Páginas del catálogo de becas', previous: 'Anterior', results: 'becas', scholarshipName: 'Beca A–Z', school: 'Universidad', searchPlaceholder: 'Buscar beca o universidad', sortBy: 'Ordenar por', stipendHigh: 'Mayor estipendio' },
}

export function ScholarshipExplorerV2({
  result,
  locale,
  messages,
}: {
  result: ScholarshipCatalogResult
  locale: LaunchLocale
  messages: Messages
}) {
  const text = labels[locale]
  const filters = result.filters

  return <>
    <form
      className={`filter-panel ${styles.panel}`}
      role="search"
      aria-label={messages.scholarships.title}
      action={`/${locale}/scholarships`}
      method="get"
    >
      <div className={`field ${styles.search}`}>
        <label htmlFor="scholarship-search">{messages.common.search}</label>
        <input id="scholarship-search" name="q" defaultValue={filters.query} placeholder={text.searchPlaceholder} />
      </div>
      <div className="field">
        <label htmlFor="scholarship-institution">{text.school}</label>
        <select id="scholarship-institution" name="institution" defaultValue={filters.institution}>
          <option value="">{messages.common.all}</option>
          {result.universityOptions.map((option) => <option value={option.value} key={option.value}>{localize(option.name, locale)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="scholarship-degree">{text.degree}</label>
        <select id="scholarship-degree" name="degree" defaultValue={filters.degree}>
          <option value="">{messages.common.all}</option>
          {Object.entries(degreeLabels(locale)).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="scholarship-funding">{text.funding}</label>
        <select id="scholarship-funding" name="funding" defaultValue={filters.funding}>
          <option value="">{messages.common.all}</option>
          <option value="full-tuition">{text.fundingFullTuition}</option>
          <option value="partial-tuition">{text.fundingPartialTuition}</option>
          <option value="stipend">{text.fundingStipend}</option>
          <option value="accommodation">{text.fundingAccommodation}</option>
          <option value="insurance">{text.fundingInsurance}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="scholarship-deadline">{text.deadline}</label>
        <select id="scholarship-deadline" name="deadline" defaultValue={filters.deadline}>
          <option value="">{messages.common.all}</option>
          <option value="future">{text.deadlineFuture}</option>
          <option value="next-30-days">{text.deadlineNext30}</option>
          <option value="next-90-days">{text.deadlineNext90}</option>
          <option value="announced">{text.deadlineAnnounced}</option>
          <option value="not-announced">{text.deadlineUnknown}</option>
          <option value="closed">{text.deadlineClosed}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="scholarship-sort">{text.sortBy}</label>
        <select id="scholarship-sort" name="sort" defaultValue={filters.sort}>
          <option value="default">{text.defaultOrder}</option>
          <option value="name">{text.scholarshipName}</option>
          <option value="deadline">{text.deadline}</option>
          <option value="stipend-desc">{text.stipendHigh}</option>
        </select>
      </div>
      <div className={styles.actions}>
        <Button type="submit">{text.apply}</Button>
        <LinkButton variant="ghost" href={`/${locale}/scholarships`}>{messages.common.clear}</LinkButton>
      </div>
    </form>

    <p className="result-count" aria-live="polite">{result.total} {text.results}</p>
    {result.items.length ? (
      <div className="content-grid">
        {result.items.map(({ scholarship }) => (
          <ScholarshipCard key={scholarship.id} scholarship={scholarship} locale={locale} messages={messages} />
        ))}
      </div>
    ) : <div className="empty-box">{text.noResults}</div>}

    {result.pageCount > 1 ? (
      <nav className={styles.pagination} aria-label={text.pagination}>
        {result.page > 1
          ? <LinkButton variant="ghost" rel="prev" href={scholarshipCatalogHref(locale, filters, result.page - 1)}>{text.previous}</LinkButton>
          : <span />}
        <strong>{result.page} / {result.pageCount}</strong>
        {result.page < result.pageCount
          ? <LinkButton variant="ghost" rel="next" href={scholarshipCatalogHref(locale, filters, result.page + 1)}>{text.next}</LinkButton>
          : <span />}
      </nav>
    ) : null}
  </>
}
