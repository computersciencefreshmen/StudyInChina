'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import type { LaunchLocale } from '@/i18n/config'
import { getSiteNotificationCopy, siteFollowKey } from '@/lib/site-notifications'
import { useSiteNotifications } from './useSiteNotifications'
import styles from './FollowUpdates.module.css'

export type FollowTarget = { kind: 'university' | 'program'; id: string; label: string }
const MAX_TARGETS = 20

export function FollowUpdates({ targets, locale, bulk = false }: {
  targets: FollowTarget[]; locale: LaunchLocale; bulk?: boolean
}) {
  const copy = getSiteNotificationCopy(locale)
  const { follows, ready, follow, unfollow } = useSiteNotifications()
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const currentTargets = [...new Map(targets.map(target => [siteFollowKey(target), target])).values()]
  const chosenTargets = currentTargets.filter(target => selected.includes(siteFollowKey(target)))
  const alreadyFollowing = currentTargets.length === 1 && follows.some(follow => siteFollowKey(follow) === siteFollowKey(currentTargets[0]))

  function toggle() {
    setStorageError(false); setSaved(false)
    if (bulk) {
      setSelected(currentTargets.length <= MAX_TARGETS ? currentTargets.map(siteFollowKey) : [])
      setExpanded(value => !value)
    } else {
      const target = currentTargets[0]
      if (target) setStorageError(!(alreadyFollowing ? unfollow(target) : follow([target])))
    }
  }

  function choose(target: FollowTarget) {
    const key = siteFollowKey(target)
    setSelected(current => current.includes(key) ? current.filter(item => item !== key)
      : current.filter(item => currentTargets.some(target => siteFollowKey(target) === item)).length < MAX_TARGETS ? [...current, key] : current)
  }

  if (!currentTargets.length) return null
  return <section className={styles.card} aria-labelledby={id + '-title'}>
    <div className={styles.heading}><span className={styles.icon} aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span><div><h2 id={id + '-title'}>{locale === 'zh' ? '关注重要更新' : locale === 'ru' ? 'Следить за важными обновлениями' : 'Follow important updates'}</h2>{!bulk && currentTargets[0] ? <p className={styles.targetName}>{currentTargets[0].label}</p> : null}</div></div>
    <p className={styles.intro}>{copy.websiteIntro}</p>
    <div className={styles.website}>
      <Button type="button" variant={alreadyFollowing ? 'ghost' : 'secondary'} onClick={toggle} disabled={!ready} aria-pressed={!bulk ? alreadyFollowing : undefined} aria-expanded={bulk ? expanded : undefined} aria-controls={bulk ? id + '-settings' : undefined}>{bulk ? copy.websiteBulk : alreadyFollowing ? copy.websiteUnfollow : copy.websiteFollow}</Button>
      <Link className={styles.centerLink} href={'/' + locale + '/notifications'}>{copy.center} →</Link>
    </div>
    {bulk && expanded ? <div id={id + '-settings'} className={styles.settings}><fieldset className={styles.targetPicker}><legend>{copy.picker}</legend><p>{copy.limit}</p><div>{currentTargets.map(target => {
      const checked = selected.includes(siteFollowKey(target))
      return <label key={siteFollowKey(target)}><input type="checkbox" checked={checked} disabled={!checked && chosenTargets.length >= MAX_TARGETS} onChange={() => choose(target)} /><span>{target.label}</span></label>
    })}</div><output>{copy.selected} {chosenTargets.length} / {MAX_TARGETS}</output></fieldset>
      <Button type="button" variant="secondary" disabled={!chosenTargets.length || chosenTargets.length > MAX_TARGETS} onClick={() => { const ok = follow(chosenTargets); setStorageError(!ok); if (ok) { setSaved(true); setExpanded(false) } }}>{copy.websiteSave}</Button>
    </div> : null}
    {saved ? <p role="status" className={styles.small}>{copy.websiteSaved}</p> : null}
    {storageError ? <p role="alert" className={styles.error}>{copy.storageError}</p> : null}
    <p className={styles.footnote}>{locale === 'zh' ? '只提醒关注后检测到的已核实重要变化。首次检查建立基线。' : locale === 'ru' ? 'Первая проверка задаёт исходное состояние. Уведомляем о последующих важных проверенных изменениях.' : 'Only important verified changes found after following appear. The first check sets a baseline.'} <Link href={'/' + locale + '/privacy'}>{locale === 'zh' ? '隐私说明' : locale === 'ru' ? 'Конфиденциальность' : 'Privacy information'} ↗</Link></p>
  </section>
}
