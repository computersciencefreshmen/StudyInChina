import type { HTMLAttributes, ReactNode } from 'react'

import { cx } from './cx'

export type BadgeTone =
  | 'neutral'
  | 'vermilion'
  | 'jade'
  | 'gold'
  | 'blue'
  | 'warning'
  | 'danger'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode
  tone?: BadgeTone
  dot?: boolean
  icon?: ReactNode
}

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  icon,
  className,
  ...props
}: BadgeProps) {
  return (
    <span className={cx('atlas-badge', `atlas-badge--${tone}`, className)} {...props}>
      {dot ? <span className="atlas-badge__dot" aria-hidden="true" /> : null}
      {icon ? <span className="atlas-badge__icon" aria-hidden="true">{icon}</span> : null}
      <span>{children}</span>
    </span>
  )
}
