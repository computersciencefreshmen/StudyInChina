import { notFound } from 'next/navigation'
import collectionJson from '../../../../content/collections/visual-media-masters.json'
import { VisualMediaCollection } from '@/components/features/VisualMediaCollection'
import { hasSearchParameters, pageMetadata, requireLocale, type PageSearchParams } from '@/lib/site'
import { parseVisualMediaFilters, type VisualMediaCollection as Collection } from '@/lib/visual-media'

export async function generateMetadata({ params, searchParams }: {
  params: Promise<{ locale: string }>
  searchParams?: Promise<PageSearchParams>
}) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const zh = locale === 'zh'
  return pageMetadata(locale,
    zh ? 'Visual Media 视觉媒体硕士' : 'Visual Media Master’s Programs in China',
    zh ? '按方向、授课语言与地区筛选中国高校视觉传达、数字媒体、电影、动画及新媒体国际硕士路径，附官方来源与申请信息。' : 'Explore international master’s routes in visual communication, digital media, film, animation and new media at Chinese universities, with official sources.',
    'visual-media', { indexable: !searchParams || !hasSearchParameters(await searchParams) })
}

export default async function VisualMediaPage({ params, searchParams }: {
  params: Promise<{ locale: string }>
  searchParams: Promise<PageSearchParams>
}) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  return <VisualMediaCollection collection={collectionJson as Collection} locale={locale} filters={parseVisualMediaFilters(await searchParams)} />
}
