import { createHash } from 'node:crypto'
import { JSDOM } from 'jsdom'

export const normalizeSourceText = value => (value || '').replace(/\s+/g, ' ').trim()
export const sourceHash = value => createHash('sha256').update(value).digest('hex')

/** Inspect only the present programme's award subsection. A prerequisite
 * degree, a navigation filter, or the duration cannot establish this field. */
export function explicitProgrammeAward(section) {
  if (!section) return null
  const heading = /^(?:degree|diploma)\s+(?:awarded|conferred)\s*[:：]?$/iu
  const level = /^(?:bachelor|master)(?:['’]s)?(?:\s+degree)?\b|^(?:ph\.?\s*d|doctorate|doctor(?:al)?\s+degree|doctor\s+of\s+philosophy)\b/iu
  const found = new Map()
  for (const label of section.querySelectorAll('strong,b,h2,h3,h4,p,div,span')) {
    const title = normalizeSourceText(label.textContent)
    if (!heading.test(title) || [...label.children].some(node => heading.test(normalizeSourceText(node.textContent)))) continue
    let after = label
    // Some templates wrap an identical heading in <strong><div>...</div></strong>.
    while (after.parentElement !== section && heading.test(normalizeSourceText(after.parentElement?.textContent))) after = after.parentElement
    let sibling = after.nextSibling
    while (sibling && !normalizeSourceText(sibling.textContent)) sibling = sibling.nextSibling
    const award = normalizeSourceText(sibling?.textContent)
    const literal = award.match(level)?.[0]
    if (!literal || award.length > 200 || /\b(?:or|and|not|instead|previous|eligible|prerequisite|applicants?|optional)\b|[/／]/iu.test(award)) return null
    const kinds = new Set([...award.matchAll(/\b(?:bachelor|master|doctor(?:ate|al)?|ph\.?\s*d)\b/giu)].map(match => match[0].toLowerCase()))
    if (kinds.size !== 1) return null
    const quote = `${title} ${award}`
    if (!normalizeSourceText(section.textContent).includes(quote)) return null
    found.set(literal.toLowerCase(), { value: literal, quote })
  }
  return found.size === 1 ? [...found.values()][0] : null
}

/** Only the public programme route is accepted. A legacy sitemap route is
 * upgraded to the /School route observed in the current public UI. Names and
 * admission facts are never taken from these URL slugs. */
export function sicasProgramIdentity(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'www.sicas.com.cn' || url.port || url.username || url.password
      || /%2f|%5c|%00/i.test(url.pathname)) return null
    const match = url.pathname.match(/^\/(?:School\/)?(\d+)\/([^/]+)\/(\d+)\/([^/]+)\/?$/i)
    if (!match) return null
    return { schoolSourceId: match[1], programmeSourceId: match[3],
      url: `https://www.sicas.com.cn/School/${match[1]}/${match[2]}/${match[3]}/${match[4]}` }
  } catch { return null }
}

/** JSDOM never executes scripts or loads remote resources in this configuration.
 * Each field is scoped to the current programme; similar-programme cards and
 * account forms cannot supply tuition, dates, names, or requirements. */
export function parseSicasProgram(html, { source, sourceUrl, fetchedAt, rawSha256 = sourceHash(html) }) {
  const identity = sicasProgramIdentity(sourceUrl)
  if (!identity || (source?.sourceId && String(source.sourceId) !== identity.programmeSourceId)
    || (source?.schoolId && source.schoolId !== `sicas-${identity.schoolSourceId}`)) return null
  const dom = new JSDOM(html, { url: identity.url })
  try {
    const document = dom.window.document
    const text = node => normalizeSourceText(node?.textContent)
    const name = text(document.querySelector('.sc-info h1.sc-title'))
    const schoolName = text(document.querySelector('.sc-info .sc-name'))
    if (!name || !schoolName || !document.querySelector('.sidebar-detail > .item')) return null
    const fields = {}, fieldEvidence = {}
    const put = (key, value, selector, quote = value) => {
      if (!value) return
      fields[key] = value
      fieldEvidence[key] = { text: quote, selector, sourceUrl: identity.url, evidenceHash: rawSha256, fetchedAt }
    }
    const labels = { 'degree': 'degree', 'start date': 'startDate', 'application fee': 'applicationFee', 'service fee': 'providerServiceFee',
      'application deadline': 'deadline', 'teaching language': 'language' }
    const tuition = []
    let precedingLabel = ''
    for (const item of document.querySelectorAll('.sidebar-detail > .item')) {
      const label = text(item.querySelector(':scope > .name')).toLowerCase()
      const value = text(item.querySelector(':scope > .des'))
      const position = [...item.parentElement.children].indexOf(item) + 1
      const selector = `.sidebar-detail > .item:nth-child(${position}) > .des`
      if (label) precedingLabel = label
      if (!value) continue
      if (labels[label]) put(labels[label], value, selector, text(item))
      if (label === 'tuition fee' || (!label && precedingLabel === 'tuition fee')) tuition.push({ value, quote: text(item), selector })
    }
    if (tuition.length) {
      // Prefer a displayed CNY amount; never convert the provider's USD amount.
      const selected = tuition.find(row => /CNY|RMB|￥|¥/.test(row.value)) || tuition[0]
      put('tuition', selected.value, selected.selector, selected.quote)
    }
    const description = text(document.querySelector('.sc-info .sc-des'))
    const duration = description.match(/\bis a\s+(.+?)\s+long program\b/i)?.[1]
    if (duration) put('duration', duration, '.sc-info .sc-des', description)
    for (const [id, field] of [['require', 'requirements'], ['materials', 'materials'], ['about-program', 'description'], ['fees', 'fees']]) {
      const value = text(document.querySelector(`#${id} > .cards-text`))
      put(field, value, `#${id} > .cards-text`)
    }
    // Duration and programme names do not establish degree. A later listing
    // hydration step may supply it with its own exact-ID receipt and evidence.
    const explicitDegree = text(document.querySelector('.sc-info .degree, .sidebar-detail .degree'))
    if (explicitDegree) put('degree', explicitDegree, '.sc-info .degree, .sidebar-detail .degree')
    if (!fields.degree) {
      const award = explicitProgrammeAward(document.querySelector('#about-program > .cards-text'))
      if (award) put('degree', award.value, '#about-program > .cards-text', award.quote)
    }
    const bodyText = text(document.body)
    for (const [field, value] of Object.entries(fields)) {
      if (!bodyText.includes(value) || !fieldEvidence[field].text.includes(value)) throw new Error(`Unbound SICAS field: ${field}`)
    }
    return {
      id: `sicas-${identity.programmeSourceId}`, provider: 'SICAS', sourceId: identity.programmeSourceId,
      schoolId: `sicas-${identity.schoolSourceId}`, schoolName, name, sourceUrl: identity.url, fetchedAt,
      status: 'extracted', official: false, admissionYear: null, evidenceHash: rawSha256,
      fields, fieldEvidence,
      displayedDates: ['startDate', 'deadline'].flatMap(field => fields[field]
        ? [{ field, display: fields[field], literalYears: [...new Set(fields[field].match(/\b(?:19|20)\d{2}\b/g) || [])] }] : []),
    }
  } finally { dom.window.close() }
}

/** Listing classification is only a separate source observation. Consumers must
 * join this by the exact programme ID and retain the listing receipt hash. */
export function parseSicasListing(html, { sourceUrl, fetchedAt, rawSha256 = sourceHash(html), degreeDisplay }) {
  const dom = new JSDOM(html, { url: sourceUrl })
  try {
    return [...dom.window.document.querySelectorAll('.item .detail .top .name > a[href]')].flatMap(anchor => {
      const identity = sicasProgramIdentity(new URL(anchor.getAttribute('href'), sourceUrl).href)
      if (!identity) return []
      return [{ id: `sicas-${identity.programmeSourceId}`, programmeSourceId: identity.programmeSourceId,
        sourceUrl: identity.url, listingSourceUrl: sourceUrl, fetchedAt, evidenceHash: rawSha256,
        name: normalizeSourceText(anchor.textContent), ...(degreeDisplay ? { degreeDisplay } : {}) }]
    })
  } finally { dom.window.close() }
}
