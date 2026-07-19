import type { FeedbackRequest } from './schema'
import { escapeHtml } from './security'

type EmailEnvironment = {
  RESEND_API_KEY?: string
  RESEND_FROM?: string
  CONTACT_RECIPIENT?: string
}

const categoryLabels: Record<FeedbackRequest['category'], string> = {
  'incorrect-data': 'Incorrect data',
  'broken-link': 'Broken link',
  'suggest-program': 'Program suggestion',
  other: 'Other feedback',
}

function feedbackHtml(feedback: FeedbackRequest): string {
  const rows: Array<[string, string]> = [
    ['Category', categoryLabels[feedback.category]],
    ['Page', feedback.pageUrl],
  ]
  if (feedback.recordId) rows.push(['Record ID', feedback.recordId])
  if (feedback.sourceUrl) rows.push(['Suggested source', feedback.sourceUrl])
  if (feedback.replyEmail) rows.push(['Reply email', feedback.replyEmail])

  const metadata = rows
    .map(
      ([label, value]) =>
        `<tr><th align="left" style="padding:4px 12px 4px 0">${escapeHtml(label)}</th><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`,
    )
    .join('')

  const message = escapeHtml(feedback.message).replace(/\r?\n/g, '<br />')
  return `<h1>StudyInChina feedback</h1><table>${metadata}</table><h2>Message</h2><p>${message}</p>`
}

function feedbackText(feedback: FeedbackRequest): string {
  return [
    'StudyInChina feedback',
    `Category: ${categoryLabels[feedback.category]}`,
    `Page: ${feedback.pageUrl}`,
    feedback.recordId ? `Record ID: ${feedback.recordId}` : null,
    feedback.sourceUrl ? `Suggested source: ${feedback.sourceUrl}` : null,
    feedback.replyEmail ? `Reply email: ${feedback.replyEmail}` : null,
    '',
    'Message:',
    feedback.message,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

export async function sendFeedbackEmail(
  feedback: FeedbackRequest,
  environment: EmailEnvironment = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM: process.env.RESEND_FROM,
    CONTACT_RECIPIENT: process.env.CONTACT_RECIPIENT,
  },
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const apiKey = environment.RESEND_API_KEY
  const from = environment.RESEND_FROM
  const recipient = environment.CONTACT_RECIPIENT
  if (!apiKey || !from || !recipient) {
    throw new Error('Feedback email delivery is not configured')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 7_000)

  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: `[StudyInChina] ${categoryLabels[feedback.category]}`,
        html: feedbackHtml(feedback),
        text: feedbackText(feedback),
        ...(feedback.replyEmail ? { reply_to: feedback.replyEmail } : {}),
      }),
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) throw new Error('Resend delivery request failed')
  } finally {
    clearTimeout(timeout)
  }
}
