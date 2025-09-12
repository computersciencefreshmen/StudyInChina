export type Lang = 'en' | 'zh' | 'ru'

export const text = (lang: Lang, map: { en: string; zh: string; ru: string }) => map[lang]

export type LText = { en: string; zh: string; ru: string }

export type RegionId = 'NORTH_CHINA' | 'NORTHEAST' | 'EAST_CHINA' | 'CENTRAL_CHINA'

export const regionLabel = (lang: Lang, r: RegionId) => {
  const dict: Record<RegionId, LText> = {
    NORTH_CHINA: { en: 'North China', zh: '华北', ru: 'Северный Китай' },
    NORTHEAST: { en: 'Northeast', zh: '东北', ru: 'Северо-Восточный' },
    EAST_CHINA: { en: 'East China', zh: '华东', ru: 'Восточный Китай' },
    CENTRAL_CHINA: { en: 'Central China', zh: '华中', ru: 'Центральный Китай' },
  }
  return dict[r][lang]
}

export type ProgramId = 'Translation' | 'International Relations'

export const programLabel = (lang: Lang, p: ProgramId) => {
  const dict: Record<ProgramId, LText> = {
    'Translation': { en: 'Translation/Interpreting', zh: '翻译/口译', ru: 'Перевод/Устный' },
    'International Relations': { en: 'International Relations', zh: '国际关系', ru: 'Международные отношения' },
  }
  return dict[p][lang]
}

export const degreeLabel = (lang: Lang, d: 'BA' | 'MA' | 'Other') => {
  const dict = {
    BA: { en: 'Bachelor', zh: '本科', ru: 'Бакалавр' },
    MA: { en: 'Master', zh: '硕士', ru: 'Магистр' },
    Other: { en: 'Other', zh: '其他', ru: 'Другое' },
  } as const
  return dict[d][lang]
}

