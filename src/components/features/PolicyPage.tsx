import { Card, PageHero } from '@/components/ui'
import type { LaunchLocale } from '@/i18n/config'

export type PolicySection = { title: string; paragraphs?: string[]; items?: string[] }
export function PolicyPage({ title, intro, eyebrow, sections, locale }: { title: string; intro: string; eyebrow: string; sections: PolicySection[]; locale: LaunchLocale }) {
  return <><PageHero variant="compact" eyebrow={eyebrow} title={title} description={intro} /><article className="atlas-container atlas-section legal-page" lang={locale}><Card className="legal-list">{sections.map((section) => <section key={section.title}><h2>{section.title}</h2>{section.paragraphs?.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{section.items ? <ul>{section.items.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}</section>)}</Card></article></>
}
