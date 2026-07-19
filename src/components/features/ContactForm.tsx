'use client'

import { FormEvent, useState } from 'react'
import Script from 'next/script'
import { Button } from '@/components/ui'
import type { LaunchLocale } from '@/i18n/config'
import type { Messages } from '@/i18n/messages'

export function ContactForm({ locale, messages, siteKey }: { locale: LaunchLocale; messages: Messages; siteKey?: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
  const configured = Boolean(siteKey)
  const configurationNote = locale === 'zh' ? '部署者配置 Turnstile、Resend 和限流环境变量后，私密反馈表单即可启用。' : locale === 'ru' ? 'Приватная форма станет доступна после настройки Turnstile, Resend и ограничения частоты.' : 'The private form becomes available after Turnstile, Resend and rate-limit variables are configured.'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!configured) return
    const form = event.currentTarget; const values = new FormData(form); const token = String(values.get('cf-turnstile-response') || '')
    if (!token) { setState('error'); return }
    setState('sending')
    try {
      const response = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: values.get('category'), message: values.get('message'), sourceUrl: values.get('sourceUrl') || undefined, replyEmail: values.get('replyEmail') || undefined, pageUrl: window.location.href, consent: values.get('consent') === 'on', turnstileToken: token, website: values.get('website') || '' }) })
      if (!response.ok) throw new Error('feedback failed')
      setState('success'); form.reset()
    } catch { setState('error') }
  }

  return <form className="form-stack" onSubmit={submit}>
    <div className="field"><label htmlFor="feedback-category">{messages.contact.category}</label><select id="feedback-category" name="category" required defaultValue="incorrect-data"><option value="incorrect-data">{messages.contact.incorrect}</option><option value="broken-link">{messages.contact.broken}</option><option value="suggest-program">{messages.contact.suggest}</option><option value="other">{messages.contact.other}</option></select></div>
    <div className="field"><label htmlFor="feedback-message">{messages.contact.message}</label><textarea id="feedback-message" name="message" required maxLength={2000} /></div>
    <div className="field"><label htmlFor="feedback-source">{messages.contact.source}</label><input id="feedback-source" name="sourceUrl" type="url" inputMode="url" placeholder="https://" /></div>
    <div className="field"><label htmlFor="feedback-email">{messages.contact.email}</label><input id="feedback-email" name="replyEmail" type="email" autoComplete="email" /></div>
    <div className="honeypot" aria-hidden="true"><label htmlFor="feedback-website">Website</label><input id="feedback-website" name="website" tabIndex={-1} autoComplete="off" /></div>
    <label className="checkbox-field"><input name="consent" type="checkbox" required /><span>{messages.contact.consent}</span></label>
    {configured ? <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" /><div className="cf-turnstile" data-sitekey={siteKey} data-theme="light" /></> : <div className="notice">{configurationNote}</div>}
    <Button type="submit" isLoading={state === 'sending'} loadingLabel={messages.contact.sending} disabled={!configured}>{messages.contact.submit}</Button>
    {state === 'success' ? <p className="form-status form-status--success" role="status">{messages.contact.success}</p> : null}
    {state === 'error' ? <p className="form-status form-status--error" role="alert">{messages.contact.error}</p> : null}
  </form>
}
