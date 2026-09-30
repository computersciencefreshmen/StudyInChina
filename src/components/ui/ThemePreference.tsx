'use client'
import { useSyncExternalStore } from 'react'
import { RoundedSelect } from './RoundedSelect'
import { siteThemes } from '@/lib/site-themes'
export const THEME_KEY = 'studycn-theme'
const subscribe = (callback: () => void) => {
  const storage = (event: StorageEvent) => { if (event.key !== THEME_KEY) return; if (siteThemes.some(theme => theme.id === event.newValue)) document.documentElement.dataset.theme = event.newValue!; callback() }
  window.addEventListener('studycn-theme-changed', callback); window.addEventListener('storage', storage)
  return () => { window.removeEventListener('studycn-theme-changed', callback); window.removeEventListener('storage', storage) }
}
const snapshot = () => siteThemes.some(theme => theme.id === document.documentElement.dataset.theme) ? document.documentElement.dataset.theme! : 'cloud'
export function useSiteTheme() { const selected = useSyncExternalStore(subscribe, snapshot, () => 'cloud'); return siteThemes.find(theme => theme.id === selected) ?? siteThemes[0] }
export function ThemePreference({ locale = 'zh', compact = false }: { locale?: string; compact?: boolean }) {
  const selected = useSyncExternalStore(subscribe, snapshot, () => 'cloud')
  const label = ({ zh: '界面主题', en: 'Theme', ru: 'Тема', de: 'Design', fr: 'Thème', es: 'Tema' } as Record<string,string>)[locale] ?? 'Theme'
  return <span style={{ display: 'inline-block', minWidth: compact ? 110 : 150 }}><RoundedSelect aria-label={label} value={selected} onChange={event => {
    document.documentElement.dataset.theme = event.target.value
    try { localStorage.setItem(THEME_KEY, event.target.value) } catch { /* Preference still applies to this visit. */ }
    window.dispatchEvent(new Event('studycn-theme-changed'))
  }}>{siteThemes.map(theme => <option value={theme.id} key={theme.id}>{locale === 'zh' ? theme.name : theme.english}</option>)}</RoundedSelect></span>
}
