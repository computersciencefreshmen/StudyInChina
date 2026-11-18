import Link from 'next/link'
import type { LaunchLocale } from '@/i18n/config'
import type { Messages } from '@/i18n/messages'
import type { CollectedProgramItem } from '@/lib/unified-programs'
import type { ThirdPartyProgram } from '@/lib/third-party-programs'
import { getProgramTranslations } from '@/lib/program-translations'
import { collectedDisplayName } from '@/lib/program-display-name'
import { containsHan, localize, localizeProgramText } from '@/lib/data/format'
import { Badge, Card, LinkButton, PageHero } from '@/components/ui'
import { degreeLabels } from '@/lib/data/labels'
import { FavoriteButton } from './FavoriteButton'
import { getMessages } from '@/i18n/messages'
import { consultationLabels, programConsultationHref } from '@/i18n/program-consultation'
import { publicSourceHref } from './ImportedPrograms'
import cardStyles from './DecisionRecordCards.module.css'
import styles from './ImportedPrograms.module.css'

const englishSourceText = {
  collected: 'Source collected', source: 'Source page', captured: 'Collected on', updated: 'Source directory date',
  notice: 'Information follows the source wording and has not been checked against the university website. Dates and fees may belong to a historical intake.',
  back: 'Back to programs', overview: 'Program overview', unknown: 'Not provided by source',
  degree: 'Study level', language: 'Teaching language', duration: 'Duration', tuition: 'Tuition as stated by source',
  startDate: 'Start date', deadline: 'Application deadline', applicationFee: 'Application fee', providerServiceFee: 'Platform service fee',
  requirements: 'Entry requirements', materials: 'Application materials', description: 'About this program', fees: 'Fee information',
  translated: 'Machine translation', sourceText: 'Source text', original: 'Show original source text', translatedOn: 'Updated',
  pending: 'Translation is not available yet. Source text is shown.',
  translationNote: 'Numbers, dates and key conditions retain their source wording.',
}
const sourceText: Record<LaunchLocale, { [Key in keyof typeof englishSourceText]: string }> = {
  en: englishSourceText,
  zh: {
    collected: '来源已采集', source: '来源页面', captured: '采集时间', updated: '来源目录日期',
    notice: '以下信息保留来源表述，尚未经院校官网核验。日期和费用可能属于历史招生批次。',
    back: '返回项目目录', overview: '项目概况', unknown: '来源未提供',
    degree: '学习层次', language: '授课语言', duration: '学习时长', tuition: '学费（按来源表述）',
    startDate: '开课时间', deadline: '申请截止时间', applicationFee: '申请费', providerServiceFee: '平台服务费',
    requirements: '申请要求', materials: '申请材料', description: '项目简介', fees: '费用说明',
    translated: '自动翻译', sourceText: '来源原文', original: '查看来源原文', translatedOn: '更新时间',
    pending: '翻译暂未提供，以下为来源原文。', translationNote: '数字、日期及关键条件保留来源原文。',
  },
  ru: {
    collected: 'Данные из источника', source: 'Страница источника', captured: 'Дата сбора', updated: 'Дата каталога источника',
    notice: 'Информация сохраняет формулировки источника и не сверена с сайтом университета. Даты и сборы могут относиться к прошлому набору.',
    back: 'К программам', overview: 'Обзор программы', unknown: 'Не указано в источнике',
    degree: 'Уровень обучения', language: 'Язык обучения', duration: 'Продолжительность', tuition: 'Стоимость по данным источника',
    startDate: 'Начало обучения', deadline: 'Срок подачи заявки', applicationFee: 'Сбор за заявку', providerServiceFee: 'Сбор платформы',
    requirements: 'Требования к поступлению', materials: 'Документы для заявки', description: 'О программе', fees: 'Информация о сборах',
    translated: 'Машинный перевод', sourceText: 'Текст источника', original: 'Показать оригинал', translatedOn: 'Обновлено',
    pending: 'Перевод пока недоступен. Показан текст источника.', translationNote: 'Числа, даты и ключевые условия сохранены в формулировке источника.',
  },
  de: {
    collected: 'Quelldaten erfasst', source: 'Quellseite', captured: 'Erfasst am', updated: 'Datum des Quellverzeichnisses',
    notice: 'Die Angaben entsprechen der Quelle und wurden nicht mit der Hochschulwebsite abgeglichen. Termine und Gebühren können zu einem früheren Aufnahmejahr gehören.',
    back: 'Zurück zu den Studiengängen', overview: 'Programmübersicht', unknown: 'In der Quelle nicht angegeben',
    degree: 'Studienniveau', language: 'Unterrichtssprache', duration: 'Dauer', tuition: 'Studiengebühren laut Quelle',
    startDate: 'Studienbeginn', deadline: 'Bewerbungsfrist', applicationFee: 'Bewerbungsgebühr', providerServiceFee: 'Plattformgebühr',
    requirements: 'Zulassungsvoraussetzungen', materials: 'Bewerbungsunterlagen', description: 'Über das Programm', fees: 'Gebühreninformationen',
    translated: 'Maschinelle Übersetzung', sourceText: 'Quelltext', original: 'Originaltext anzeigen', translatedOn: 'Aktualisiert',
    pending: 'Eine Übersetzung ist noch nicht verfügbar. Der Quelltext wird angezeigt.', translationNote: 'Zahlen, Termine und wesentliche Bedingungen bleiben im Wortlaut der Quelle erhalten.',
  },
  fr: {
    collected: 'Informations collectées', source: 'Page source', captured: 'Collecté le', updated: 'Date du catalogue source',
    notice: 'Les informations reprennent la formulation de la source et n’ont pas été vérifiées sur le site de l’université. Les dates et frais peuvent concerner une ancienne session.',
    back: 'Retour aux programmes', overview: 'Présentation du programme', unknown: 'Non indiqué par la source',
    degree: 'Niveau d’études', language: 'Langue d’enseignement', duration: 'Durée', tuition: 'Frais de scolarité selon la source',
    startDate: 'Date de début', deadline: 'Date limite de candidature', applicationFee: 'Frais de candidature', providerServiceFee: 'Frais de la plateforme',
    requirements: 'Conditions d’admission', materials: 'Documents de candidature', description: 'À propos du programme', fees: 'Informations sur les frais',
    translated: 'Traduction automatique', sourceText: 'Texte source', original: 'Afficher le texte original', translatedOn: 'Mis à jour le',
    pending: 'La traduction n’est pas encore disponible. Le texte source est affiché.', translationNote: 'Les nombres, dates et conditions essentielles conservent la formulation de la source.',
  },
  es: {
    collected: 'Información recopilada', source: 'Página de origen', captured: 'Recopilado el', updated: 'Fecha del catálogo de origen',
    notice: 'La información mantiene la redacción de la fuente y no se ha contrastado con el sitio de la universidad. Las fechas y tarifas pueden corresponder a una convocatoria anterior.',
    back: 'Volver a los programas', overview: 'Descripción del programa', unknown: 'No indicado por la fuente',
    degree: 'Nivel de estudios', language: 'Idioma de enseñanza', duration: 'Duración', tuition: 'Matrícula según la fuente',
    startDate: 'Fecha de inicio', deadline: 'Plazo de solicitud', applicationFee: 'Tasa de solicitud', providerServiceFee: 'Tarifa de la plataforma',
    requirements: 'Requisitos de admisión', materials: 'Documentos de solicitud', description: 'Acerca del programa', fees: 'Información sobre las tarifas',
    translated: 'Traducción automática', sourceText: 'Texto de origen', original: 'Mostrar el texto original', translatedOn: 'Actualizado el',
    pending: 'La traducción aún no está disponible. Se muestra el texto de origen.', translationNote: 'Los números, fechas y condiciones esenciales mantienen la redacción de la fuente.',
  },
}
export function programSourceText(locale: LaunchLocale) {
  return sourceText[locale]
}

type CollectedCardProps = { item: CollectedProgramItem; locale: LaunchLocale; messages: Messages }
export function CollectedProgramCard(props: CollectedCardProps) {
  const title = localizeProgramText(props.item.collected.name, props.locale)
  if (props.locale !== 'en' || !containsHan(title)) return <CollectedCard {...props} title={title} />
  return collectedDisplayName(props.item.collected, props.locale).then(name => <CollectedCard {...props} title={name} />)
}

function CollectedCard({ item, locale, messages, title }: CollectedCardProps & { title: string }) {
  const record = item.collected, t = programSourceText(locale)
  const facts = [[t.language, record.fields.language], [t.duration, record.fields.duration], [t.tuition, record.fields.tuition]].filter(([, value]) => value)
  return <Card className={`record-card ${cardStyles.card} ${cardStyles.programCard}`} data-program-preview data-source-status="source-collected">
    <div className={cardStyles.identityRow}>
      {record.fields.degree ? <Badge tone="vermilion">{item.degree && item.degree !== 'other' ? degreeLabels(locale)[item.degree] : record.fields.degree}</Badge> : null}
      <Badge tone="blue">{t.collected}</Badge>
    </div>
    <div className={cardStyles.programIdentity}><h3 className={`record-card__title ${cardStyles.programTitle}`}>{title}</h3><p className="record-card__place">{item.university ? localize(item.university.name, locale) : record.schoolName}</p></div>
    <dl className={`record-facts ${cardStyles.supportingFacts}`}>
      {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <p className="record-card__place">{record.provider}{record.fetchedAt ? ` · ${t.captured}: ${record.fetchedAt.slice(0, 10)}` : ''}</p>
    <div className="record-card__actions">
      <LinkButton href={`/${locale}/programs/${encodeURIComponent(record.id)}`} variant="secondary" size="small">{messages.common.viewDetails}</LinkButton>
      <FavoriteButton programId={record.id} saveLabel={messages.common.save} savedLabel={messages.common.saved} />
      {publicSourceHref(record.sourceUrl) ? <a className="text-link" href={record.sourceUrl} target="_blank" rel="noopener noreferrer">{t.source} ↗</a> : null}
    </div>
  </Card>
}

export async function CollectedProgramDetail({ item, locale }: { item: CollectedProgramItem; locale: LaunchLocale }) {
  const record = item.collected, t = programSourceText(locale)
  const messages = getMessages(locale)
  const [translations, title] = await Promise.all([getProgramTranslations(record, locale), collectedDisplayName(record, locale)])
  const facts = ['degree', 'language', 'duration', 'startDate', 'deadline', 'tuition', 'applicationFee', 'providerServiceFee'] as const
  const sections = ['description', 'requirements', 'materials', 'fees'] as const
  return <>
    <PageHero variant="compact" title={title} description={item.university ? localize(item.university.name, locale) : record.schoolName}
      eyebrow={record.fields.degree || undefined}
      meta={<><Badge tone="blue">{t.collected}</Badge><span>{record.provider}</span></>}
      actions={<><FavoriteButton programId={record.id} saveLabel={messages.common.save} savedLabel={messages.common.saved} />
        <Link className="text-link" href={programConsultationHref(locale, record.id)}>{consultationLabels[locale]}</Link>
        <Link className="text-link" href={`/${locale}/programs`}>← {t.back}</Link></>} />
    <section className={`atlas-container atlas-section ${styles.workspace}`} data-program-detail data-source-status="source-collected">
      <div className={styles.detailLayout}>
        <div className={styles.detailMain}>
          <section className={styles.detailSection}><h2>{t.overview}</h2><dl className={styles.detailFacts}>
            {facts.map(key => <div key={key}><dt>{t[key]}</dt><dd>{record.fields[key] || t.unknown}
              {record.fieldSources?.[key] && <small> · <a href={record.fieldSources[key].url} target="_blank" rel="noreferrer">{t.source} · {record.fieldSources[key].collectedAt.slice(0, 10)}</a></small>}
            </dd></div>)}
          </dl></section>
          {sections.filter(key => record.fields[key]).map(key => {
            const translated = key === 'fees' ? undefined : translations[key]
            return <section key={key} className={styles.detailSection} data-program-section={key}
              data-translation-status={key === 'fees' ? 'source' : translated?.method || 'pending'}>
              <h2>{t[key]}</h2>
              {record.fieldSources?.[key] && <small><a href={record.fieldSources[key].url} target="_blank" rel="noreferrer">{t.source} · {record.fieldSources[key].collectedAt.slice(0, 10)}</a></small>}
              {translated ? <>
                <p><small>{translated.method === 'minimax' ? t.translated : t.sourceText} · {t.translatedOn}: {translated.translatedAt.slice(0, 10)}</small></p>
                {translated.method === 'minimax' ? <p><small>{t.translationNote}</small></p> : null}
                <p className={styles.sourceText} lang={locale}>{translated.text}</p>
                <details><summary>{t.original}</summary><p className={styles.sourceText}>{record.fields[key]}</p></details>
              </> : locale === 'en' && containsHan(localizeProgramText(record.fields[key]!, locale)) ? <>
                <p><small>English translation awaiting review.</small></p>
                <details><summary>{t.original}</summary><p className={styles.sourceText}>{record.fields[key]}</p></details>
              </> : <>
                {locale !== 'en' && key !== 'fees' && <p><small>{t.pending}</small></p>}
                <p className={styles.sourceText}>{localizeProgramText(record.fields[key]!, locale)}</p>
              </>}
            </section>
          })}
        </div>
        <aside className={styles.provenance}><h2>{t.source}</h2><span className={styles.provider}>{record.provider}</span>
          <dl>{record.fetchedAt ? <div><dt>{t.captured}</dt><dd>{record.fetchedAt}</dd></div> : null}
            {record.sourceUpdatedAt ? <div><dt>{t.updated}</dt><dd>{record.sourceUpdatedAt}</dd></div> : null}</dl>
          {publicSourceHref(record.sourceUrl) ? <a className="text-link" href={record.sourceUrl} target="_blank" rel="noopener noreferrer">{t.source} ↗</a> : null}
          <p>{t.notice}</p>
          {title !== record.name && <details><summary>{t.original}</summary><p>{record.name}</p></details>}
          {item.sources.filter(source => source.id !== record.id).map(source => <p key={source.id}><a className="text-link" href={source.sourceUrl} target="_blank" rel="noopener noreferrer">{source.provider} ↗</a>{source.fetchedAt ? ` · ${source.fetchedAt.slice(0, 10)}` : ''}</p>)}
        </aside>
      </div>
    </section>
  </>
}

export function ProgramSourceReferences({ sources, locale }: { sources: ThirdPartyProgram[]; locale: LaunchLocale }) {
  const t = programSourceText(locale)
  return sources.length ? <ul className="source-list">{sources.map(source => <li key={source.id}>
    <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">{source.provider} · {t.source} ↗</a>
    {source.fetchedAt ? <small>{t.captured}: {source.fetchedAt}</small> : null}
  </li>)}</ul> : null
}
