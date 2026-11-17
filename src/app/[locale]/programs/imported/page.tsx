import { notFound, permanentRedirect } from 'next/navigation'
import { requireLocale, type PageSearchParams } from '@/lib/site'

export default async function ImportedProgramsRedirect({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<PageSearchParams>
}) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const raw = await searchParams
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value
  const query = new URLSearchParams()
  const q = first(raw.query) || first(raw.q)
  const institution = first(raw.school) || first(raw.institution)
  if (q) query.set('q', q.slice(0, 200))
  if (institution) query.set('institution', institution.slice(0, 160))
  permanentRedirect(`/${locale}/programs${query.size ? `?${query}` : ''}`)
}
