import type { LaunchLocale } from '@/i18n/config'

export const SITE_NOTIFICATIONS_KEY = 'studycn:notifications:v1'
export const SITE_NOTIFICATIONS_EVENT = 'studycn:notifications-changed'
export const EMPTY_NOTIFICATIONS = '{"follows":[],"readIds":[],"events":[],"baseline":{},"initializedTargets":[],"lastCheckedAt":0,"summaryFrequency":"five-hours"}'
export type NotificationSummaryFrequency = 'five-hours' | 'daily'
export function notificationSummaryInterval(frequency: NotificationSummaryFrequency): number {
  return (frequency === 'daily' ? 24 : 5) * 60 * 60_000
}
export type SiteFollow = { kind: 'university' | 'program'; id: string; label: string; followedAt: number }
export type SiteUpdate = {
  eventId: string; id: string; kind: SiteFollow['kind']; universityId: string
  title: string; slug: string; change: 'created' | 'updated'; publishedAt: number
}
export type SiteObservation = {
  observationKey: string; id: string; kind: SiteFollow['kind']; universityId: string
  title: string; slug: string; fingerprint: string; verified: boolean
}
type Baseline = SiteObservation & { occurrence: number }
export type SiteNotificationState = {
  follows: SiteFollow[]; readIds: string[]; events: SiteUpdate[]
  baseline: Record<string, Baseline>; initializedTargets: string[]; lastCheckedAt: number; summaryFrequency: NotificationSummaryFrequency
}
export const siteFollowKey = (follow: Pick<SiteFollow, 'kind' | 'id'>) => `${follow.kind}:${follow.id}`
const idPattern = /^[a-z0-9][a-z0-9:_-]{0,199}$/u

export function parseSiteNotifications(raw: string | null): SiteNotificationState {
  try {
    const value: unknown = JSON.parse(raw || EMPTY_NOTIFICATIONS)
    if (!value || typeof value !== 'object') return emptyState()
    const record = value as Record<string, unknown>
    const follows = Array.isArray(record.follows) ? record.follows.filter((item): item is SiteFollow => {
      if (!item || typeof item !== 'object') return false
      return (item.kind === 'university' || item.kind === 'program') && typeof item.id === 'string'
        && idPattern.test(item.id) && typeof item.label === 'string' && item.label.length > 0 && item.label.length <= 300
        && typeof item.followedAt === 'number' && Number.isFinite(item.followedAt) && item.followedAt >= 0 && item.followedAt <= 8_640_000_000_000_000
    }).slice(0, 500) : []
    const baseline = record.baseline && typeof record.baseline === 'object' ? Object.fromEntries(Object.entries(record.baseline).flatMap(([key, value]) => {
      const valid = parseSiteObservations([value])[0]
      const occurrence = value && typeof value === 'object' && 'occurrence' in value ? value.occurrence : 0
      return valid && valid.observationKey === key && Number.isSafeInteger(occurrence) && Number(occurrence) >= 0 ? [[key, { ...valid, occurrence: Number(occurrence) }]] : []
    })) : {}
    return {
      follows: [...new Map(follows.map(item => [siteFollowKey(item), item])).values()],
      readIds: Array.isArray(record.readIds) ? [...new Set(record.readIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 600))].slice(-100) : [],
      events: parseSiteUpdates(record.events).slice(-100), baseline,
      initializedTargets: Array.isArray(record.initializedTargets) ? record.initializedTargets.filter((key): key is string => typeof key === 'string' && key.length <= 210) : [],
      summaryFrequency: record.summaryFrequency === 'daily' ? 'daily' : 'five-hours',
      lastCheckedAt: typeof record.lastCheckedAt === 'number' && Number.isFinite(record.lastCheckedAt) && record.lastCheckedAt >= 0 ? record.lastCheckedAt : 0,
    }
  } catch { return emptyState() }
}

function emptyState(): SiteNotificationState { return { follows: [], readIds: [], events: [], baseline: {}, initializedTargets: [], lastCheckedAt: 0, summaryFrequency: 'five-hours' } }

export function matchesSiteFollow(follow: SiteFollow, observation: Pick<SiteObservation, 'id' | 'kind' | 'universityId'>): boolean {
  return follow.kind === 'program' ? observation.kind === 'program' && follow.id === observation.id : follow.id === observation.universityId
}

export function parseSiteObservations(value: unknown): SiteObservation[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is SiteObservation => item && typeof item === 'object'
    && (item.kind === 'university' || item.kind === 'program') && typeof item.verified === 'boolean'
    && typeof item.observationKey === 'string' && /^(university|program|cycle):[a-z0-9][a-z0-9:_-]{0,199}$/u.test(item.observationKey)
    && typeof item.id === 'string' && idPattern.test(item.id)
    && typeof item.universityId === 'string' && idPattern.test(item.universityId)
    && typeof item.title === 'string' && item.title.length <= 500
    && typeof item.slug === 'string' && item.slug.length > 0 && item.slug.length <= 300
    && typeof item.fingerprint === 'string' && item.fingerprint.length > 0 && item.fingerprint.length <= 200)
}

/** The first successful check is a baseline; future verified transitions become local updates. */
export function applySiteObservations(state: SiteNotificationState, observations: SiteObservation[], observedAt: number): SiteNotificationState {
  const baseline = Object.fromEntries(Object.entries(state.baseline).filter(([, value]) => state.follows.some(follow => matchesSiteFollow(follow, value))))
  const newEvents: SiteUpdate[] = []
  for (const item of observations) {
    const followers = state.follows.filter(follow => matchesSiteFollow(follow, item))
    if (!followers.length) continue
    const previous = baseline[item.observationKey]
    if (!item.verified) {
      if (!previous) baseline[item.observationKey] = { ...item, occurrence: 0 }
      continue
    }
    const initialized = followers.some(follow => state.initializedTargets.includes(siteFollowKey(follow)))
    const changed = previous?.fingerprint !== item.fingerprint
    const occurrence = (previous?.occurrence ?? 0) + (changed ? 1 : 0)
    if (changed && initialized) newEvents.push({
      eventId: `${item.observationKey}:${item.fingerprint}:${occurrence}`, id: item.id, kind: item.kind,
      universityId: item.universityId, title: item.title, slug: item.slug,
      change: previous ? 'updated' : 'created', publishedAt: observedAt,
    })
    baseline[item.observationKey] = { ...item, occurrence }
  }
  const events = [...new Map([...state.events, ...newEvents].filter(event => event.publishedAt >= observedAt - 30 * 86_400_000 && state.follows.some(follow => matchesSiteFollow(follow, event))).map(event => [event.eventId, event])).values()].slice(-100)
  return { ...state, baseline, events, readIds: state.readIds.filter(id => events.some(event => event.eventId === id)).slice(-100), initializedTargets: state.follows.map(siteFollowKey), lastCheckedAt: observedAt }
}

export function parseSiteUpdates(value: unknown): SiteUpdate[] {
  if (!Array.isArray(value)) return []
  return value.filter((event): event is SiteUpdate => event && typeof event === 'object'
    && (event.kind === 'university' || event.kind === 'program')
    && (event.change === 'created' || event.change === 'updated')
    && typeof event.eventId === 'string' && event.eventId.length > 0 && event.eventId.length <= 600
    && typeof event.id === 'string' && idPattern.test(event.id)
    && typeof event.universityId === 'string' && idPattern.test(event.universityId)
    && typeof event.title === 'string' && event.title.length <= 500
    && typeof event.slug === 'string' && event.slug.length > 0 && event.slug.length <= 300
    && typeof event.publishedAt === 'number' && Number.isFinite(event.publishedAt) && event.publishedAt >= 0 && event.publishedAt <= 8_640_000_000_000_000)
}

/** Follows begin now; a public history must not become an unsolicited backlog. */
export function followedSiteUpdates(follows: SiteFollow[], events: SiteUpdate[]): SiteUpdate[] {
  const matching = events.filter(event => follows.some(follow => event.publishedAt >= follow.followedAt && matchesSiteFollow(follow, event)))
  return [...new Map(matching.map(event => [event.eventId, event])).values()].sort((a, b) => b.publishedAt - a.publishedAt)
}

const copy = {
  zh: {
    nav: '通知', title: '你关注的更新', eyebrow: '站内通知', intro: '关注学校和专业，返回网站时检查已核实并发布的重要变化。首次检查会建立基线，之后发现的变化显示在这里。',
    websiteFollow: '在网站关注', websiteUnfollow: '取消站内关注', websiteBulk: '选择站内关注项目', websiteSave: '保存站内关注', websiteSaved: '站内关注已保存。',
    websiteIntro: '关注保存在当前浏览器，返回网站时检查变化。', center: '查看我的通知', picker: '选择站内关注项目', limit: '每次最多选择 20 项。', selected: '已选择',
    loading: '正在载入更新…', unavailable: '更新通知暂时无法载入，请稍后重试。关注设置仍保存在当前浏览器。', retry: '重新加载', detected: '检测时间',
    noFollows: '还没有站内关注', noFollowsDetail: '在学校或专业详情页点击“在网站关注”，重要变化就会显示在这里。', explore: '查找学校',
    empty: '暂时没有新的重要更新', emptyDetail: '首次检查会建立基线；之后发现的重要变化才产生通知。',
    followed: '我的站内关注', remove: '取消关注', read: '标为已读', allRead: '全部标为已读', unread: '未读', viewed: '已读', created: '新增信息', updated: '重要更新',
    local: '关注、变化基线与已读状态仅保存在当前浏览器，不会跨设备同步。清除网站数据会删除这些设置。返回网站时检查变化，并最多保留最近 100 条通知，最长 30 天。',
    summaryFrequency: '通知汇总频率', fiveHours: '每 5 小时汇总', daily: '每日汇总', refresh: '立即刷新',
    summaryDetail: '按所选间隔在打开网站或返回标签页时检查。可随时立即刷新；网站关闭时不会后台推送，也不会发送邮件。',
    storageError: '当前浏览器无法保存设置，请检查网站存储权限。', fallback: '',
  },
  en: {
    nav: 'Updates', title: 'Updates you follow', eyebrow: 'Website notifications', intro: 'Follow universities and programs to check important verified and published changes when you return. The first check sets a baseline; changes found afterward appear here.',
    websiteFollow: 'Follow on this website', websiteUnfollow: 'Stop following on website', websiteBulk: 'Choose website follows', websiteSave: 'Save website follows', websiteSaved: 'Website follows saved.',
    websiteIntro: 'Follows stay in this browser. Changes are checked when you return.', center: 'View my updates', picker: 'Choose website follows', limit: 'Choose up to 20 items per request.', selected: 'Selected',
    loading: 'Loading updates…', unavailable: 'Updates could not be loaded. Try again later. Your follows remain saved in this browser.', retry: 'Try again', detected: 'Detected',
    noFollows: 'No website follows yet', noFollowsDetail: 'Choose “Follow on this website” on a university or program page to see important changes here.', explore: 'Explore universities',
    empty: 'No new important updates', emptyDetail: 'The first check sets a baseline. Only important changes found afterward produce notifications.',
    followed: 'My website follows', remove: 'Stop following', read: 'Mark as read', allRead: 'Mark all as read', unread: 'Unread', viewed: 'Read', created: 'New information', updated: 'Important update',
    local: 'Follows, change baselines and read status stay in this browser and do not sync across devices. Clearing website data removes these settings. Changes are checked when you return; the latest 100 notifications are kept for up to 30 days.',
    summaryFrequency: 'Summary frequency', fiveHours: 'Every 5 hours', daily: 'Daily summary', refresh: 'Refresh now',
    summaryDetail: 'Checks run when you open or return to the website after the selected interval. Refresh anytime; no background or email delivery while the website is closed.',
    storageError: 'This browser could not save your settings. Check website storage permissions.', fallback: 'The notification interface is currently provided in English.',
  },
  ru: {
    nav: 'Обновления', title: 'Обновления ваших подписок', eyebrow: 'Уведомления на сайте', intro: 'Следите за вузами и программами. При возвращении проверяем важные опубликованные изменения. Первая проверка задаёт исходное состояние; последующие изменения появятся здесь.',
    websiteFollow: 'Следить на сайте', websiteUnfollow: 'Не следить на сайте', websiteBulk: 'Выбрать подписки на сайте', websiteSave: 'Сохранить подписки', websiteSaved: 'Подписки на сайте сохранены.',
    websiteIntro: 'Подписки хранятся в этом браузере. Проверяем изменения при возвращении.', center: 'Мои уведомления', picker: 'Выберите подписки на сайте', limit: 'До 20 записей в одном запросе.', selected: 'Выбрано',
    loading: 'Загружаем обновления…', unavailable: 'Не удалось загрузить обновления. Повторите позже. Подписки сохранены в этом браузере.', retry: 'Повторить', detected: 'Обнаружено',
    noFollows: 'Пока нет подписок на сайте', noFollowsDetail: 'Нажмите «Следить на сайте» на странице вуза или программы, чтобы видеть важные изменения здесь.', explore: 'Найти вузы',
    empty: 'Нет новых важных обновлений', emptyDetail: 'Первая проверка задаёт исходное состояние. Уведомления появляются только при последующих важных изменениях.',
    followed: 'Мои подписки на сайте', remove: 'Не следить', read: 'Отметить прочитанным', allRead: 'Прочитать все', unread: 'Не прочитано', viewed: 'Прочитано', created: 'Новая запись', updated: 'Важное обновление',
    local: 'Подписки, исходное состояние записей и отметки о прочтении хранятся только в этом браузере без синхронизации. Очистка данных удаляет настройки. Проверяем изменения при возвращении и храним последние 100 уведомлений до 30 дней.',
    summaryFrequency: 'Частота сводки', fiveHours: 'Каждые 5 часов', daily: 'Ежедневная сводка', refresh: 'Обновить сейчас',
    summaryDetail: 'Проверяем при открытии или возвращении на сайт после выбранного интервала. Можно обновить вручную. При закрытом сайте нет фоновых уведомлений или писем.',
    storageError: 'Браузер не смог сохранить настройки. Проверьте разрешения на хранение данных сайта.', fallback: '',
  },
}

export function getSiteNotificationCopy(locale: LaunchLocale) {
  return copy[locale === 'zh' || locale === 'ru' ? locale : 'en']
}

export function getNotificationPrivacy(locale: LaunchLocale) {
  if (locale === 'zh') return {
    title: '站内关注与通知', paragraphs: [
      '关注的学校或专业、关注时间、汇总频率、变化基线、通知与已读状态仅保存在当前浏览器，不会跨设备同步。清除网站数据会删除这些设置。最近 100 条通知最多保留 30 天。',
      '返回网站或重新打开页面时，浏览器读取公开的已核实目录摘要并与本地基线比较，自动检查按你选择的每 5 小时或每日间隔进行。首次检查只建立基线，也可手动立即刷新。网站关闭时不会后台推送通知或发送邮件。',
      '关注偏好无需上传；你可以在通知页取消关注或标为已读。未核实记录与核验日期等维护性刷新不会产生重要更新。',
    ],
  }
  if (locale === 'ru') return {
    title: 'Подписки и уведомления на сайте', paragraphs: [
      'Выбранные вузы и программы, время подписки, исходные данные, уведомления и отметки о прочтении хранятся только в этом браузере без синхронизации. Очистка данных удаляет настройки. Храним последние 100 уведомлений до 30 дней.',
      'При возвращении браузер читает публичные проверенные записи и сравнивает их с местными исходными данными. Автоматические проверки выполняются с выбранным интервалом: 5 часов или сутки. Первая проверка задаёт исходное состояние; обновить можно вручную. При закрытом сайте фоновых уведомлений и писем нет.',
      'Настройки подписок не отправляются на сервер. Подписки и отметки о прочтении можно изменить на странице уведомлений. Непроверенные записи и обновление даты проверки не создают важных уведомлений.',
    ],
  }
  return {
    title: 'Website follows and notifications', paragraphs: [
      'Followed university and program IDs, follow times, summary frequency, change baselines, notifications and read status stay only in this browser and do not sync across devices. Clearing website data removes these preferences. The latest 100 notifications are kept for up to 30 days.',
      'When you return, the browser reads a public verified catalogue summary and compares it with the local baseline. Automatic checks use your selected five-hour or daily interval. The first check only establishes a baseline; you can also refresh manually. There are no background notifications or emails while the website is closed.',
      'Follow preferences do not need to be uploaded. You can stop following or mark updates as read in the notification center. Unverified records and maintenance-only verification date refreshes do not create important updates.',
    ],
  }
}
