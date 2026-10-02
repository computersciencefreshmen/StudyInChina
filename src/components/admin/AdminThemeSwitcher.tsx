'use client'

import type { CSSProperties } from 'react'
import { siteThemes, type SiteTheme } from '@/lib/site-themes'
import { THEME_KEY } from '@/components/ui/ThemePreference'
import { WorkbenchIcon } from './WorkbenchIcon'
import styles from './Workbench.module.css'

export function AdminThemeSwitcher({ selected }: { selected: SiteTheme }) {
  return <div className={styles.themeSwitcher}>
    <div className={styles.themeSwitcherHeading}><span><WorkbenchIcon name="palette" size={15} />工作台主题</span><small>五种界面 · 同一份实时数据</small></div>
    <div className={styles.themeChoices} role="group" aria-label="管理员五主题切换">{siteThemes.map(theme => <button type="button" key={theme.id} aria-pressed={selected.id === theme.id} onClick={() => {
      document.documentElement.dataset.theme = theme.id
      try { localStorage.setItem(THEME_KEY, theme.id) } catch { /* The theme still applies for this visit. */ }
      window.dispatchEvent(new Event('studycn-theme-changed'))
    }} style={{ '--choice-ink': theme.ink, '--choice-surface': theme.surface, '--choice-accent': theme.accent } as CSSProperties}>
      <span className={styles.themeSwatch} aria-hidden="true"><i style={{ background: theme.background }} /><i style={{ background: theme.accent }} /><i style={{ background: theme.secondary }} /></span><span><strong>{theme.name}</strong><small>{theme.english}</small></span>{selected.id === theme.id ? <WorkbenchIcon name="check" size={15} /> : null}
    </button>)}</div>
  </div>
}
