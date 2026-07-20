import { notFound } from 'next/navigation'
import { Badge, Card, PageHero } from '@/components/ui'
import { launchLocales } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import { formatDate, localize } from '@/lib/data/format'
import { getGuide, guides } from '@/lib/guides'
import { pageMetadata, requireLocale } from '@/lib/site'

export function generateStaticParams() { return launchLocales.flatMap((locale) => guides.map(({ slug }) => ({ locale, slug }))) }
export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) { const { locale: raw, slug } = await params; const locale = requireLocale(raw) || 'en'; const guide = getGuide(slug); if (!guide) return {}; return pageMetadata(locale, localize(guide.title, locale), localize(guide.summary, locale), `guides/${slug}`) }
export default async function GuideDetail({ params }: { params: Promise<{ locale: string; slug: string }> }) { const { locale: raw, slug } = await params; const locale = requireLocale(raw); if (!locale) notFound(); const guide = getGuide(slug); if (!guide) notFound(); const messages = getMessages(locale); return <><PageHero variant="compact" eyebrow={`${messages.common.lastVerified}: ${formatDate(guide.updatedAt, locale, guide.updatedAt)}`} title={localize(guide.title, locale)} description={localize(guide.summary, locale)} /><article className="atlas-container atlas-section guide-article"><div className="guide-steps">{guide.sections.map((section, sectionIndex) => <section className="prose-panel" key={sectionIndex}><Badge tone={sectionIndex === 0 ? 'vermilion' : 'jade'}>0{sectionIndex + 1}</Badge><h2>{localize(section.title, locale)}</h2><ol>{section.items.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ol></section>)}</div><Card accent="jade"><h2 className="atlas-card__title">{messages.guide.usingTitle}</h2><p>{messages.common.authoritativeNotice}</p><p className="atlas-card__description">{messages.guide.disclaimer}</p></Card></article></> }
