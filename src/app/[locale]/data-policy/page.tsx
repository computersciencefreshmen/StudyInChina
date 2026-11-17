import { notFound } from 'next/navigation'
import { PolicyPage } from '@/components/features/PolicyPage'
import { getMessages } from '@/i18n/messages'
import { pageMetadata, requireLocale } from '@/lib/site'

const sourceScope = {
  en: { intro: 'Programs presents collected records in one catalogue. Verification rules apply to facts explicitly marked verified.', title: 'Sources and collection', text: 'Each record retains its source and capture date. Extracted platform information is published without university-by-university verification. Dates, fees and requirements preserve source wording and may describe historical intakes. Missing values remain unavailable. Discovery URLs without captured details are not programme cards. Collection alone does not establish official verification.' },
  zh: { intro: 'Programs 统一展示已收录的项目。核验规则适用于明确标为已核验的内容。', title: '项目来源与采集', text: '每条记录保留来源和采集时间。从平台提取的信息可直接发布，不逐条进行院校官网核验。日期、费用和申请条件保留来源表述，可能属于历史批次；缺失值保持未提供。尚未抓到详情的网址只用于发现目标，不显示为空项目。完成采集不等同于完成官方核验。' },
  ru: { intro: 'Все собранные программы представлены в одном каталоге. Правила проверки относятся к явно проверенным фактам.', title: 'Источники и сбор данных', text: 'Каждая запись сохраняет источник и дату сбора. Данные платформ публикуются без индивидуальной проверки на сайте вуза. Даты, стоимость и требования следуют источнику и могут относиться к прошлому набору. Пропуски остаются неизвестными. URL без собранных сведений не становятся карточками программ. Сбор не означает официальную проверку.' },
  de: { intro: 'Programs zeigt alle erfassten Einträge in einem Katalog. Prüfregeln gelten für ausdrücklich geprüfte Angaben.', title: 'Quellen und Datenerfassung', text: 'Jeder Eintrag behält Quelle und Erfassungsdatum. Plattformangaben werden ohne Einzelprüfung auf Hochschulwebseiten veröffentlicht. Termine, Gebühren und Voraussetzungen folgen der Quelle und können frühere Zulassungsrunden betreffen. Fehlende Werte bleiben unbekannt. URLs ohne erfasste Details erscheinen nicht als leere Studiengänge. Erfassung bedeutet keine offizielle Prüfung.' },
  fr: { intro: 'Programs réunit les données collectées dans un catalogue unique. Les règles de vérification concernent les faits explicitement vérifiés.', title: 'Sources et collecte', text: 'Chaque fiche conserve sa source et sa date de collecte. Les informations des plateformes sont publiées sans vérification individuelle sur les sites universitaires. Dates, frais et conditions suivent la source et peuvent concerner une ancienne session. Les valeurs absentes restent inconnues. Une URL sans détails collectés ne devient pas une fiche vide. La collecte ne constitue pas une vérification officielle.' },
  es: { intro: 'Programs reúne los registros recopilados en un solo catálogo. Las reglas de verificación se aplican a los datos marcados como verificados.', title: 'Fuentes y recopilación', text: 'Cada registro conserva su fuente y fecha de captura. Los datos de plataformas se publican sin verificación individual en la web universitaria. Fechas, tasas y requisitos siguen la fuente y pueden corresponder a convocatorias anteriores. Los valores ausentes siguen siendo desconocidos. Una URL sin detalles recopilados no aparece como programa vacío. Recopilar no equivale a verificar oficialmente.' },
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
