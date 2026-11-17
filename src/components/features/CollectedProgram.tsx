import Link from 'next/link'
import type { LaunchLocale } from '@/i18n/config'
import type { Messages } from '@/i18n/messages'
import type { CollectedProgramItem } from '@/lib/unified-programs'
import type { ThirdPartyProgram } from '@/lib/third-party-programs'
import { Badge, Card, LinkButton, PageHero } from '@/components/ui'
import { degreeLabels } from '@/lib/data/labels'
import { publicSourceHref } from './ImportedPrograms'
import cardStyles from './DecisionRecordCards.module.css'
import styles from './ImportedPrograms.module.css'

export function programSourceText(locale: LaunchLocale) {
  return locale === 'zh' ? {
    collected: '来源已采集', source: '来源页面', captured: '采集时间', updated: '来源目录日期',
    notice: '以下信息保留来源表述，尚未经院校官网核验。日期和费用可能属于历史招生批次。',
    back: '返回项目目录', overview: '项目概况', unknown: '来源未提供',
    degree: '学习层次', language: '授课语言', duration: '学习时长', tuition: '学费（按来源表述）',
    startDate: '开课时间', deadline: '申请截止时间', applicationFee: '申请费', providerServiceFee: '平台服务费',
    requirements: '申请要求', materials: '申请材料', description: '项目简介', fees: '费用说明',
  } : {
    collected: 'Source collected', source: 'Source page', captured: 'Collected on', updated: 'Source directory date',
    notice: 'Information follows the source wording and has not been checked against the university website. Dates and fees may belong to a historical intake.',
    back: 'Back to programs', overview: 'Program overview', unknown: 'Not provided by source',
    degree: 'Study level', language: 'Teaching language', duration: 'Duration', tuition: 'Tuition as stated by source',
    startDate: 'Start date', deadline: 'Application deadline', applicationFee: 'Application fee', providerServiceFee: 'Platform service fee',
    requirements: 'Entry requirements', materials: 'Application materials', description: 'About this program', fees: 'Fee information',
  }
}

export function CollectedProgramCard({ item, locale, messages }: { item: CollectedProgramItem; locale: LaunchLocale; messages: Messages }) {
  const record = item.collected, t = programSourceText(locale)
  const facts = [[t.language, record.fields.language], [t.duration, record.fields.duration], [t.tuition, record.fields.tuition]].filter(([, value]) => value)
  return <Card className={`record-card ${cardStyles.card} ${cardStyles.programCard}`} data-program-preview data-source-status="source-collected">
    <div className={cardStyles.identityRow}>
      {record.fields.degree ? <Badge tone="vermilion">{item.degree && item.degree !== 'other' ? degreeLabels(locale)[item.degree] : record.fields.degree}</Badge> : null}
      <Badge tone="blue">{t.collected}</Badge>
    </div>
    <div className={cardStyles.programIdentity}><h3 className={`record-card__title ${cardStyles.programTitle}`}>{record.name}</h3><p className="record-card__place">{record.schoolName}</p></div>
    <dl className={`record-facts ${cardStyles.supportingFacts}`}>
      {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <p className="record-card__place">{record.provider}{record.fetchedAt ? ` · ${t.captured}: ${record.fetchedAt.slice(0, 10)}` : ''}</p>
    <div className="record-card__actions">
      <LinkButton href={`/${locale}/programs/${encodeURIComponent(record.id)}`} variant="secondary" size="small">{messages.common.viewDetails}</LinkButton>
      {publicSourceHref(record.sourceUrl) ? <a className="text-link" href={record.sourceUrl} target="_blank" rel="noopener noreferrer">{t.source} ↗</a> : null}
    </div>
  </Card>
}

export function CollectedProgramDetail({ item, locale }: { item: CollectedProgramItem; locale: LaunchLocale }) {
  const record = item.collected, t = programSourceText(locale)
  const facts = ['degree', 'language', 'duration', 'startDate', 'deadline', 'tuition', 'applicationFee', 'providerServiceFee'] as const
  const sections = ['description', 'requirements', 'materials', 'fees'] as const
  return <>
    <PageHero variant="compact" title={record.name} description={record.schoolName}
      eyebrow={record.fields.degree || undefined}
      meta={<><Badge tone="blue">{t.collected}</Badge><span>{record.provider}</span></>}
      actions={<Link className="text-link" href={`/${locale}/programs`}>← {t.back}</Link>} />
    <section className={`atlas-container atlas-section ${styles.workspace}`} data-program-detail data-source-status="source-collected">
      <div className={styles.detailLayout}>
        <div className={styles.detailMain}>
          <section className={styles.detailSection}><h2>{t.overview}</h2><dl className={styles.detailFacts}>
            {facts.map(key => <div key={key}><dt>{t[key]}</dt><dd>{record.fields[key] || t.unknown}</dd></div>)}
          </dl></section>
          {sections.filter(key => record.fields[key]).map(key => <section key={key} className={styles.detailSection}><h2>{t[key]}</h2><p className={styles.sourceText}>{record.fields[key]}</p></section>)}
        </div>
        <aside className={styles.provenance}><h2>{t.source}</h2><span className={styles.provider}>{record.provider}</span>
          <dl>{record.fetchedAt ? <div><dt>{t.captured}</dt><dd>{record.fetchedAt}</dd></div> : null}
            {record.sourceUpdatedAt ? <div><dt>{t.updated}</dt><dd>{record.sourceUpdatedAt}</dd></div> : null}</dl>
          {publicSourceHref(record.sourceUrl) ? <a className="text-link" href={record.sourceUrl} target="_blank" rel="noopener noreferrer">{t.source} ↗</a> : null}
          <p>{t.notice}</p>
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
