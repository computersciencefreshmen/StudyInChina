import type { ReactNode } from 'react'

import { cx } from './cx'

export interface SectionHeadingProps {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  action?: ReactNode
  align?: 'start' | 'center'
  level?: 2 | 3
  className?: string
}

export function SectionHeading({
  title,
  description,
  eyebrow,
  action,
  align = 'start',
  level = 2,
  className,
}: SectionHeadingProps) {
  const Heading = level === 2 ? 'h2' : 'h3'

  return (
    <div className={cx('atlas-section-heading', `atlas-section-heading--${align}`, className)}>
      <div className="atlas-section-heading__copy">
        {eyebrow ? <div className="atlas-kicker">{eyebrow}</div> : null}
        <Heading className="atlas-section-heading__title">{title}</Heading>
        {description ? (
          <div className="atlas-section-heading__description">{description}</div>
        ) : null}
      </div>
      {action ? <div className="atlas-section-heading__action">{action}</div> : null}
    </div>
  )
}
