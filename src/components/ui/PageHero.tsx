import type { ReactNode } from 'react'

import { cx } from './cx'

export interface PageHeroProps {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  aside?: ReactNode
  variant?: 'default' | 'compact' | 'feature'
  className?: string
}

export function PageHero({
  title,
  description,
  eyebrow,
  actions,
  meta,
  aside,
  variant = 'default',
  className,
}: PageHeroProps) {
  return (
    <header className={cx('atlas-hero', `atlas-hero--${variant}`, className)}>
      <span className="atlas-hero__sun" aria-hidden="true" />
      <span className="atlas-hero__route" aria-hidden="true" />
      <div className="atlas-hero__content">
        {eyebrow ? <div className="atlas-hero__eyebrow">{eyebrow}</div> : null}
        <h1 className="atlas-hero__title">{title}</h1>
        {description ? <div className="atlas-hero__description">{description}</div> : null}
        {actions ? <div className="atlas-hero__actions">{actions}</div> : null}
        {meta ? <div className="atlas-hero__meta">{meta}</div> : null}
      </div>
      {aside ? <div className="atlas-hero__aside">{aside}</div> : null}
    </header>
  )
}
