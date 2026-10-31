import { inflateRawSync, crc32 } from 'node:zlib'
import { posix } from 'node:path'
import { JSDOM } from 'jsdom'

export const OPENXML_WORKBOOK_PARSER = 'openxml-literal-workbook-v1' as const
const fail = (reason: string): never => { throw new Error(`workbook_evidence:${reason}`) }
const need: (condition: unknown, reason: string) => asserts condition = (condition, reason) => { if (!condition) fail(reason) }
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships'

/** Read bounded ZIP members without writing files, running Excel or evaluating formulas. */
function parts(raw: Uint8Array): Map<string, Uint8Array> {
  const b = Buffer.from(raw)
  need(b.length >= 22 && b.length <= 10 * 1024 * 1024, 'archive_size')
  let end = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { end = i; break }
  }
  need(end >= 0, 'zip_directory_missing')
  const count = b.readUInt16LE(end + 10), size = b.readUInt32LE(end + 12), start = b.readUInt32LE(end + 16)
  need(b.readUInt16LE(end + 4) === 0 && b.readUInt16LE(end + 6) === 0
    && b.readUInt16LE(end + 8) === count && count > 0 && count <= 400 && start + size === end, 'zip_directory_bounds')
  const result = new Map<string, Uint8Array>(), ranges: Array<[number, number]> = []
  let cursor = start, total = 0
  for (let n = 0; n < count; n++) {
    need(cursor + 46 <= end && b.readUInt32LE(cursor) === 0x02014b50, 'zip_member_header')
    const flags = b.readUInt16LE(cursor + 8), method = b.readUInt16LE(cursor + 10), checksum = b.readUInt32LE(cursor + 16)
    const compressed = b.readUInt32LE(cursor + 20), expanded = b.readUInt32LE(cursor + 24), length = b.readUInt16LE(cursor + 28)
    const extra = b.readUInt16LE(cursor + 30), comment = b.readUInt16LE(cursor + 32), offset = b.readUInt32LE(cursor + 42)
    need(cursor + 46 + length + extra + comment <= end && length > 0 && compressed !== 0xffffffff
      && expanded <= 8 * 1024 * 1024 && offset + 30 <= start && b.readUInt16LE(cursor + 34) === 0, 'zip_member_bounds')
    const name = decode(b.subarray(cursor + 46, cursor + 46 + length))
    need(!result.has(name) && /^[A-Za-z0-9_.\-/\[\]]+$/.test(name) && !name.startsWith('/')
      && !name.split('/').some(part => part === '..' || part === '.') && !(flags & 1)
      && (method === 0 || method === 8), 'unsafe_zip_member')
    need(b.readUInt32LE(offset) === 0x04034b50 && b.readUInt16LE(offset + 6) === flags
      && b.readUInt16LE(offset + 8) === method, 'zip_local_header')
    const localLength = b.readUInt16LE(offset + 26), localExtra = b.readUInt16LE(offset + 28)
    const data = offset + 30 + localLength + localExtra, last = data + compressed
    need(localLength === length && data <= start && last <= start
      && decode(b.subarray(offset + 30, offset + 30 + localLength)) === name, 'zip_local_bounds')
    need(ranges.every(([a, z]) => last <= a || offset >= z), 'overlapping_zip_members')
    ranges.push([offset, last])
    total += expanded
    need(total <= 64 * 1024 * 1024, 'zip_expansion_limit')
    const stored = b.subarray(data, last)
    const content = method === 0 ? stored : inflateRawSync(stored, { maxOutputLength: 8 * 1024 * 1024 })
    need(content.length === expanded && crc32(content) === checksum, 'zip_crc_or_size')
    result.set(name, content)
    cursor += 46 + length + extra + comment
  }
  need(cursor === end, 'unread_zip_members')
  return result
}

function xml(bytes: Uint8Array | undefined): Document {
  need(bytes, 'xml_part_missing')
  const text = decode(bytes)
  need(!/<!DOCTYPE|<!ENTITY/i.test(text), 'xml_entities_forbidden')
  try { return new JSDOM(text, { contentType: 'application/xml' }).window.document }
  catch { return fail('invalid_xml') }
}
const direct = (element: Element, name: string): Element[] => Array.from(element.children)
  .filter(child => child.namespaceURI === MAIN && child.localName === name)
function literal(element: Element | undefined): string {
  if (!element) return ''
  const text = direct(element, 't')[0]
  return text ? text.textContent ?? '' : direct(element, 'r').map(run => direct(run, 't')[0]?.textContent ?? '').join('')
}

/** The projection retains worksheet/row/cell coordinates and literal values.
 * Merged cells are not filled down. Hidden data and formula caches require a
 * separate reviewed policy and therefore fail this initial literal-only path. */
export function literalWorkbookText(raw: Uint8Array): string {
  const files = parts(raw)
  need(files.has('[Content_Types].xml') && !Array.from(files.keys()).some(name => /vbaProject|externalLinks|macrosheets/i.test(name)), 'unsupported_workbook_content')
  const workbook = xml(files.get('xl/workbook.xml'))
  const rels = xml(files.get('xl/_rels/workbook.xml.rels'))
  const relations = new Map<string, Element>()
  for (const rel of Array.from(rels.getElementsByTagNameNS(PACKAGE, 'Relationship'))) {
    const id = rel.getAttribute('Id')
    need(id && !relations.has(id) && rel.getAttribute('TargetMode') !== 'External', 'workbook_relationship')
    relations.set(id, rel)
  }
  const strings = files.has('xl/sharedStrings.xml')
    ? Array.from(xml(files.get('xl/sharedStrings.xml')).getElementsByTagNameNS(MAIN, 'si')).map(literal) : []
  const sheets = Array.from(workbook.getElementsByTagNameNS(MAIN, 'sheet'))
  need(sheets.length > 0 && sheets.length <= 100, 'sheet_count')
  const seen = new Set<string>(), names = new Set<string>(), lines: string[] = []
  let cells = 0
  for (const sheet of sheets) {
    const name = sheet.getAttribute('name'), rel = relations.get(sheet.getAttributeNS(REL, 'id') ?? '')
    need(name && !/[\r\n]/.test(name) && !names.has(name) && (!sheet.hasAttribute('state') || sheet.getAttribute('state') === 'visible')
      && rel && rel.getAttribute('Type')?.endsWith('/worksheet'), 'sheet_identity_or_state')
    names.add(name)
    const target = rel.getAttribute('Target') ?? '', part = posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join('xl', target))
    need(part.startsWith('xl/worksheets/') && !seen.has(part), 'worksheet_path')
    seen.add(part)
    const tree = xml(files.get(part)), data = tree.getElementsByTagNameNS(MAIN, 'sheetData')
    need(data.length === 1, 'sheet_data')
    lines.push('SHEET ' + name)
    let previousRow = 0
    for (const row of direct(data[0], 'row')) {
      const r = row.getAttribute('r') ?? '', number = Number(r)
      need(/^[1-9][0-9]{0,6}$/.test(r) && number > previousRow && number <= 1048576 && row.getAttribute('hidden') !== '1', 'row_identity_or_state')
      previousRow = number
      const rowCells: string[] = [], used = new Set<string>()
      for (const cell of direct(row, 'c')) {
        const reference = cell.getAttribute('r') ?? '', match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(reference)
        need(match && match[2] === r && !used.has(reference) && ++cells <= 200000 && direct(cell, 'f').length === 0, 'cell_identity_or_formula')
        used.add(reference)
        const kind = cell.getAttribute('t') ?? 'n', stored = direct(cell, 'v')[0]?.textContent ?? ''
        need(['s', 'inlineStr', 'n', 'b', 'e', 'str', 'd'].includes(kind), 'cell_type')
        let value = stored
        if (kind === 's') {
          need(/^(0|[1-9][0-9]*)$/.test(stored) && Number(stored) < strings.length, 'shared_string_index')
          value = strings[Number(stored)]
        } else if (kind === 'inlineStr') value = literal(direct(cell, 'is')[0])
        rowCells.push(reference + '=' + value)
      }
      lines.push('ROW ' + r + ': ' + rowCells.join(' | '))
    }
  }
  need(Array.from(files.keys()).filter(name => /^xl\/worksheets\/[^/]+\.xml$/.test(name)).every(name => seen.has(name)), 'undeclared_worksheet')
  return lines.join('\n') + '\n'
}

export function verifyLiteralWorkbookText(raw: Uint8Array, text: Uint8Array): string {
  const derived = literalWorkbookText(raw)
  need(decode(text) === derived, 'literal_projection_mismatch')
  return derived
}
