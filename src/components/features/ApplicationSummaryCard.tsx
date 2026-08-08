import type { ReactNode } from 'react'
import { Card } from '@/components/ui'
import type { CardAccent } from '@/components/ui/Card'
import styles from './ApplicationSummaryCard.module.css'

export type ApplicationSummaryFact = {
  label: string
  value: ReactNode
}

export function ApplicationSummaryCard({
  eyebrow,
  title,
  status,
  facts,
  notice,
  actions,
  accent = 'none',
}: {
  eyebrow: string
  title: string
  status?: ReactNode
  facts: ApplicationSummaryFact[]
  notice?: string
  actions?: ReactNode
  accent?: CardAccent
}) {
  return <Card as="section" accent={accent} className={styles.summary}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2 className={styles.title}>{title}</h2>
      </div>
      {status}
    </header>
    <dl className={styles.facts}>
      {facts.map((fact) => <div className={styles.fact} key={fact.label}>
        <dt>{fact.label}</dt>
        <dd>{fact.value}</dd>
      </div>)}
    </dl>
    {notice ? <p className={styles.notice}>{notice}</p> : null}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </Card>
}
