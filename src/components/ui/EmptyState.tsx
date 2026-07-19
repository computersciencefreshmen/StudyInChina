import type { ReactNode } from 'react'

export interface EmptyStateProps {
  title: string
  description?: string
  eyebrow?: string
  icon?: ReactNode
  action?: ReactNode
}

export function EmptyState({ title, description, eyebrow, icon, action }: EmptyStateProps) {
  return (
    <section className="atlas-empty-state" aria-live="polite">
      <div className="atlas-empty-state__mark" aria-hidden="true">
        {icon ?? <span>空</span>}
      </div>
      <div className="atlas-empty-state__content">
        {eyebrow ? <p className="atlas-kicker">{eyebrow}</p> : null}
        <h2 className="atlas-empty-state__title">{title}</h2>
        {description ? <p className="atlas-empty-state__description">{description}</p> : null}
        {action ? <div className="atlas-empty-state__action">{action}</div> : null}
      </div>
    </section>
  )
}
