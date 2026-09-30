import type { CSSProperties } from 'react'

export type IconName = 'grid' | 'check' | 'database' | 'activity' | 'spark' | 'arrow' | 'play' | 'refresh' | 'logout' | 'palette' | 'globe' | 'chevron' | 'shield' | 'clock' | 'close'
const paths: Record<IconName, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  check: 'm5 12 4 4L19 6',
  database: 'M20 5c0 2-3.6 3-8 3S4 7 4 5s3.6-3 8-3 8 1 8 3z M4 5v14c0 2 3.6 3 8 3s8-1 8-3V5 M4 12c0 2 3.6 3 8 3s8-1 8-3',
  activity: 'M2 12h5l3-9 4 18 3-9h5',
  spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
  arrow: 'M5 12h14 m-6-6 6 6-6 6',
  play: 'm8 4 12 8-12 8z',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M5.5 7a8 8 0 0 1 13-2L20 7 M4 17l1.5 2a8 8 0 0 0 13-2',
  logout: 'M9 3H4v18h5 M10 12h12 m-5-5 5 5-5 5',
  palette: 'M12 3a9 9 0 1 0 0 18h1c2 0 3-2 2-3s-1-3 1-3h2c5 0 5-12-6-12z M7 9h.01 M11 6h.01 M16 7h.01 M6 14h.01',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18z',
  chevron: 'm7 10 5 5 5-5',
  shield: 'm12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6z m-4 10 3 3 5-6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M12 7v5l3 2',
  close: 'm6 6 12 12 M6 18 18 6',
}
export function WorkbenchIcon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>
}
