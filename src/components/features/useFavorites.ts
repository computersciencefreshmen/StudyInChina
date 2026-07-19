'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { FAVORITES_EVENT, FAVORITES_KEY, parseFavorites } from '@/lib/favorites'

const EMPTY_SNAPSHOT = '[]'

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback)
  window.addEventListener(FAVORITES_EVENT, callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(FAVORITES_EVENT, callback)
  }
}

function getSnapshot() {
  return window.localStorage.getItem(FAVORITES_KEY) || EMPTY_SNAPSHOT
}

export function useFavorites() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT)
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false)
  const favorites = useMemo(() => parseFavorites(raw), [raw])

  const toggle = useCallback((id: string) => {
    const current = parseFavorites(window.localStorage.getItem(FAVORITES_KEY))
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event(FAVORITES_EVENT))
  }, [])

  return { favorites, ready, toggle }
}
