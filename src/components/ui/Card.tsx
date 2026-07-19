import type { HTMLAttributes, ReactNode } from 'react'

import { cx } from './cx'

export type CardVariant = 'default' | 'featured' | 'quiet'
export type CardAccent = 'none' | 'vermilion' | 'jade'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'article' | 'div' | 'li' | 'section'
  variant?: CardVariant
  accent?: CardAccent
  children: ReactNode
}

export function Card({
  as: Element = 'article',
  variant = 'default',
  accent = 'none',
  children,
  className,
  ...props
}: CardProps) {
  return (
    <Element
      className={cx(
        'atlas-card',
        `atlas-card--${variant}`,
        accent !== 'none' && `atlas-card--accent-${accent}`,
        className,
      )}
      {...props}
    >
      {children}
    </Element>
  )
}
