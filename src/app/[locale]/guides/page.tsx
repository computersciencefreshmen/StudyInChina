import { notFound } from 'next/navigation'
import { Badge, Card, LinkButton, PageHero } from '@/components/ui'
import { getMessages } from '@/i18n/messages'
import { formatDate, localize } from '@/lib/data/format'
import { guides } from '@/lib/guides'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale); return pageMetadata(locale, m.guide.title, m.guide.intro, 'guides') }
export default async function GuidesPage({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale); if (!locale) notFound(); const messages = getMessages(locale); return <><PageHero variant="compact" eyebrow={locale === 'zh' ? '申请路径' : locale === 'ru' ? 'Путь абитуриента' : 'Applicant pathway'} title={messages.guide.title} description={messages.guide.intro} /><section className="atlas-container atlas-section"><div className="content-grid">{guides.map((guide, index) => <Card key={guide.slug} accent={index === 0 ? 'vermilion' : 'none'} className="record-card"><div className="record-card__top"><Badge tone="neutral">0{index + 1}</Badge><span className="atlas-muted">{formatDate(guide.updatedAt, locale, guide.updatedAt)}</span></div><h2 className="record-card__title">{localize(guide.title, locale)}</h2><p className="record-card__summary">{localize(guide.summary, locale)}</p><div className="atlas-card__footer"><LinkButton href={`/${locale}/guides/${guide.slug}`} variant="quiet">{messages.common.viewDetails} →</LinkButton></div></Card>)}</div></section></> }
