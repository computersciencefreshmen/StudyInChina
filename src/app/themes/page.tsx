import { ThemeStudio } from '@/components/admin/ThemeStudio'
import { getCatalogData } from '@/lib/data/load'
import { selectPublishedData } from '@/lib/data/publication'
import { localize } from '@/lib/data/format'
export default async function ThemesPage() {
  const data = selectPublishedData(await getCatalogData())
  const universities = data.universities.filter(item => item.featured).slice(0, 3)
  return <ThemeStudio counts={{ universities: data.universities.length, programs: data.programs.length, scholarships: data.scholarships.length, cities: data.cities.length }} universities={universities.map(item => ({ name: localize(item.name, 'zh'), city: localize(data.cities.find(city => city.id === item.cityId)?.name ?? { en: '', zh: '', ru: '' }, 'zh'), cityId: item.cityId, slug: item.slug, programs: data.programs.filter(program => program.universityId === item.id).length }))} />
}
