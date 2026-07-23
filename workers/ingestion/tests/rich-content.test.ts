import assert from 'node:assert/strict'
import test from 'node:test'
import {
  convertDocumentToText,
  isConvertibleDocument,
  renderBrowserPage,
  type BrowserQuickActionInput,
} from '../src/rich-content'

test('document detection covers PDF and scanned-image sources without treating HTML as a document', () => {
  assert.equal(isConvertibleDocument('application/pdf', 'https://admissions.example.edu.cn/guide'), true)
  assert.equal(isConvertibleDocument('application/octet-stream', 'https://admissions.example.edu.cn/guide.PDF'), true)
  assert.equal(isConvertibleDocument('image/tiff', 'https://admissions.example.edu.cn/scan'), true)
  assert.equal(isConvertibleDocument('text/html', 'https://admissions.example.edu.cn/guide'), false)
})

test('browser rendering uses an allowlist and never sends cookies or authentication', async () => {
  let input: BrowserQuickActionInput | undefined
  const rendered = await renderBrowserPage({
    async quickAction(action, value) {
      assert.equal(action, 'content')
      input = value
      return Response.json({ success: true, result: '# Official admissions\nDeadline: 2026-09-01' })
    },
  }, {
    url: 'https://admissions.example.edu.cn/programs',
    allowedHosts: ['admissions.example.edu.cn'],
    userAgent: 'StudyInChinaDataBot/1.0',
    timeoutMs: 1_000,
    maxBytes: 10_000,
  })

  assert.match(rendered, /Official admissions/)
  assert.deepEqual(input?.gotoOptions, { waitUntil: 'networkidle2' })
  assert.match(input?.allowRequestPattern[0] ?? '', /admissions\\\.example\\\.edu\\\.cn/)
  assert.equal(Object.hasOwn(input ?? {}, 'cookies'), false)
  assert.equal(Object.hasOwn(input ?? {}, 'authenticate'), false)
  assert.equal(Object.hasOwn(input ?? {}, 'setExtraHTTPHeaders'), false)
})

test('Workers AI converts PDF bytes to bounded plain text and fails closed on conversion errors', async () => {
  let requestedFormat: string | undefined
  const converted = await convertDocumentToText({
    async toMarkdown(document, options) {
      assert.equal(document.name, '2026-guide.pdf')
      assert.equal(document.blob.type, 'application/pdf')
      requestedFormat = options?.output?.format
      return { format: 'text', data: 'Tuition: CNY 30,000 per academic year' }
    },
  }, new TextEncoder().encode('%PDF test').buffer, 'application/pdf',
  'https://admissions.example.edu.cn/2026-guide.pdf', { timeoutMs: 1_000, maxCharacters: 10_000 })

  assert.equal(requestedFormat, 'text')
  assert.match(converted, /30,000/)

  await assert.rejects(
    convertDocumentToText({
      async toMarkdown() {
        return { format: 'error', error: 'unreadable scan' }
      },
    }, new ArrayBuffer(1), 'image/png', 'https://admissions.example.edu.cn/scan.png',
    { timeoutMs: 1_000, maxCharacters: 10_000 }),
    (error: unknown) => (error as { code?: string }).code === 'document_conversion_failed',
  )
})
