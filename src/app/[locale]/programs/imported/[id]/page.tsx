import { notFound, permanentRedirect } from 'next/navigation'
import { requireLocale } from '@/lib/site'
import { getTodayDate } from '@/lib/data/freshness'
import { resolveUnifiedProgram } from '@/lib/unified-programs'

export default async function ImportedProgramRedirect({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: value, id } = await params
  const locale = requireLocale(value)
  if (!locale) notFound()
  const resolved = await resolveUnifiedProgram(id, getTodayDate())
  if (!resolved) notFound()
  permanentRedirect(`/${locale}/programs/${encodeURIComponent(resolved.canonical)}`)
}
