'use client'

import { Button } from '@/components/ui'
import { useFavorites } from './useFavorites'

export function FavoriteButton({ programId, saveLabel, savedLabel }: { programId: string; saveLabel: string; savedLabel: string }) {
  const { favorites, ready, toggle } = useFavorites()
  const saved = favorites.includes(programId)
  return <Button variant={saved ? 'secondary' : 'quiet'} size="small" onClick={() => toggle(programId)} aria-pressed={saved} disabled={!ready}>{saved ? `★ ${savedLabel}` : `☆ ${saveLabel}`}</Button>
}
