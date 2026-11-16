export type VisualMediaText = { en: string; zh?: string }
export type VisualMediaCategory = 'visual-communication' | 'digital-media' | 'film-animation' | 'new-media' | 'adjacent'
export type VisualMediaRegion = 'mainland' | 'hong-kong' | 'macao'

/** A research collection is separate from a current, open admission-cycle claim. */
export type VisualMediaProgram = {
  id: string
  university: VisualMediaText
  city: VisualMediaText
  name: VisualMediaText
  category: VisualMediaCategory
  region?: VisualMediaRegion
  fit?: 'direct' | 'adjacent'
  teachingLanguages?: Array<'English' | 'Chinese' | 'Bilingual'>
  language: VisualMediaText
  duration: VisualMediaText
  tuition: VisualMediaText
  application: VisualMediaText
  portfolio: VisualMediaText
  internationalEligibility: VisualMediaText
  evidenceStatus: 'confirmed' | 'needs-confirmation'
  cycle: VisualMediaText
  notes: VisualMediaText
  sources: Array<{ label: string; url: string }>
}

export type VisualMediaCollection = {
  checkedOn: string
  scope: VisualMediaText
  programs: VisualMediaProgram[]
}

export type VisualMediaFilters = {
  query: string
  region: string
  language: string
  category: string
}

const regions = new Set(['mainland', 'hong-kong', 'macao'])
const categories = new Set(['visual-communication', 'digital-media', 'film-animation', 'new-media', 'adjacent'])
const languages = new Set(['English', 'Chinese', 'Bilingual'])

export function visualMediaText(text: VisualMediaText, locale: string): string {
  return locale === 'zh' ? text.zh || text.en : text.en
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\-_]+/gu, ' ').trim()
}

/** Only topic-specific queries receive a collection shortcut. No catalogue rows are reclassified. */
export function isVisualMediaQuery(query: string): boolean {
  const normalized = normalize(query)
  return /\b(?:visual (?:media|communication|arts?)|digital (?:media|arts?)|new media|animation|film(?:making)?|cinema|photography|graphic design|interaction design)\b/u.test(normalized)
    || /视觉媒体|视觉传达|视觉艺术|数字媒体|数字艺术|新媒体|动画|影视|电影|摄影|平面设计|交互设计/u.test(normalized)
    || /визуальн\p{L}* (?:медиа|коммуникац\p{L}*)|цифров\p{L}* (?:медиа|искусств\p{L}*)|анимаци\p{L}*|кино/u.test(normalized)
}

export function parseVisualMediaFilters(params: Record<string, string | string[] | undefined>): VisualMediaFilters {
  const read = (key: string) => typeof params[key] === 'string' ? params[key].trim().slice(0, 160) : ''
  return {
    query: read('q'),
    region: regions.has(read('region')) ? read('region') : '',
    language: languages.has(read('language')) ? read('language') : '',
    category: categories.has(read('category')) ? read('category') : '',
  }
}

export function filterVisualMediaPrograms(collection: VisualMediaCollection, filters: VisualMediaFilters): VisualMediaProgram[] {
  const query = normalize(filters.query)
  const broadTopics = new Set(['visual media', 'visual media master', 'visual media masters', '视觉媒体', '视觉媒体硕士', 'визуальные медиа'])
  const isBroadTopic = broadTopics.has(query) || /^visual media master['’]?s?(?: (?:programs?|programmes?|degrees?))?$/u.test(query)
  const tokens = query && !isBroadTopic ? query.split(' ') : []
  const categoryAliases: Record<VisualMediaCategory, string> = {
    'visual-communication': 'visual communication graphic design 视觉传达 平面设计',
    'digital-media': 'digital media digital art 数字媒体 数字艺术',
    'film-animation': 'film cinema animation filmmaking 电影 影视 动画',
    'new-media': 'new media interactive interaction design 新媒体 互动 交互设计',
    adjacent: 'design communication adjacent 设计 传播',
  }
  return collection.programs.filter(program => {
    if (program.evidenceStatus !== 'confirmed' || program.sources.length === 0) return false
    if (filters.region && (program.region || 'mainland') !== filters.region) return false
    if (filters.category && program.category !== filters.category) return false
    const knownLanguages: readonly string[] = program.teachingLanguages || (
      /^english\b/iu.test(program.language.en) ? ['English']
        : /^chinese\b/iu.test(program.language.en) ? ['Chinese']
          : /^bilingual\b/iu.test(program.language.en) ? ['Bilingual'] : []
    )
    if (filters.language && !knownLanguages.includes(filters.language)) return false
    const searchable = normalize([
      ...Object.values(program.name), ...Object.values(program.university),
      ...Object.values(program.city), ...Object.values(program.notes),
      categoryAliases[program.category],
    ].join(' '))
    return tokens.every(token => searchable.includes(token))
  })
}
