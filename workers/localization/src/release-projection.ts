import type { LegacyLocalizedContentStatus, TranslationStatus } from './types'

export type ReleaseTranslationStatus = 'reviewed' | 'published' | 'fallback'

export function toReleaseTranslationStatus(
  status: LegacyLocalizedContentStatus | TranslationStatus,
  sourceLocale: string | null,
): ReleaseTranslationStatus | null {
  if (status === 'reviewed' || status === 'published') return status
  if (
    (status === 'machine' || status === 'machine_generated')
    && sourceLocale
  ) return 'fallback'
  return null
}

