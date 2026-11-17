import { notFound } from 'next/navigation'
import { PolicyPage } from '@/components/features/PolicyPage'
import { getMessages } from '@/i18n/messages'
import { pageMetadata, requireLocale } from '@/lib/site'

const sourceScope = {
  en: { intro: 'The verification rules below apply to the official-source catalogue.', title: 'Third-party program directory', text: 'The separate third-party directory publishes extracted provider information with source links and capture dates, without university-by-university official verification. Dates, fees and requirements retain the source wording and may describe historical intakes. Missing values remain unavailable. Sitemap-only records contain URL-derived names and links, without admission facts. These imports do not acquire the official catalogue’s verified status.' },
  zh: { intro: '以下核验规则适用于官方来源目录。', title: '第三方项目目录', text: '独立的第三方目录可直接展示从平台提取的信息，附来源链接与采集时间，不逐条进行院校官网核验。日期、费用和申请条件保留来源表述，可能属于历史批次；缺失值保持未提供。仅来自站点地图的记录只有根据网址整理的名称与链接，不包含招生事实。这些导入记录不获得官方来源目录的“已核验”状态。' },
  ru: { intro: 'Правила проверки ниже относятся к каталогу официальных источников.', title: 'Каталог сторонних программ', text: 'Отдельный сторонний каталог публикует извлечённые сведения платформ со ссылками и датами сбора, без проверки каждого факта на сайте вуза. Даты, стоимость и требования сохраняют формулировки источника и могут относиться к прошлому набору. Пропуски остаются неизвестными. Записи из карты сайта содержат только названия из URL и ссылки. Импорт не получает статус официальной проверки.' },
  de: { intro: 'Die folgenden Prüfregeln gelten für den Katalog mit offiziellen Quellen.', title: 'Studiengänge aus Drittquellen', text: 'Das separate Drittanbieter-Verzeichnis veröffentlicht extrahierte Plattformangaben mit Quellenlink und Erfassungsdatum, ohne Einzelprüfung auf Hochschulwebseiten. Termine, Gebühren und Voraussetzungen folgen der Quelle und können frühere Zulassungsrunden betreffen. Fehlende Werte bleiben unbekannt. Sitemap-Einträge enthalten nur aus URLs abgeleitete Namen und Links. Diese Importe erhalten keinen offiziell geprüften Status.' },
  fr: { intro: 'Les règles de vérification ci-dessous concernent le catalogue de sources officielles.', title: 'Catalogue de programmes tiers', text: 'Le catalogue tiers distinct publie les informations extraites des plateformes avec leur source et leur date de collecte, sans vérification individuelle sur les sites universitaires. Dates, frais et conditions conservent le texte de la source et peuvent concerner une ancienne session. Les valeurs manquantes restent inconnues. Les entrées de sitemap contiennent uniquement des noms tirés des URL et des liens. Ces imports ne reçoivent pas le statut de vérification officielle.' },
  es: { intro: 'Las reglas de verificación siguientes se aplican al catálogo de fuentes oficiales.', title: 'Directorio de programas de terceros', text: 'El directorio separado de terceros publica información extraída de plataformas con fuente y fecha de captura, sin verificar cada dato en la web universitaria. Fechas, tasas y requisitos conservan el texto de la fuente y pueden corresponder a convocatorias anteriores. Los valores ausentes siguen siendo desconocidos. Las entradas del sitemap solo contienen nombres derivados de URL y enlaces. Estas importaciones no reciben el estado de verificación oficial.' },
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale) || 'en'
  const copy = getMessages(locale).legal.dataPolicy
  return pageMetadata(locale, copy.title, `${sourceScope[locale].intro} ${sourceScope[locale].text}`, 'data-policy')
}

export default async function DataPolicyPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const copy = getMessages(locale).legal.dataPolicy
  const scope = sourceScope[locale]
  return <PolicyPage locale={locale} eyebrow={copy.eyebrow} title={copy.title}
    intro={`${scope.intro} ${copy.intro}`}
    sections={[{ title: scope.title, paragraphs: [scope.text] }, ...copy.sections]} />
}
