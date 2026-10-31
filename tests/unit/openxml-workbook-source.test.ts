import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { literalWorkbookText, OPENXML_WORKBOOK_PARSER, verifyLiteralWorkbookText } from '../../scripts/maintenance/openxml-workbook-source'
import { verifyReviewedProposalEvidence } from '../../scripts/maintenance/import-identities'
import { maintenanceProposalSchema, proposalContentSha256, type MaintenanceProposal, type MaintenanceScope } from '../../scripts/maintenance/contracts'

const root = join(process.cwd(), 'tests/fixtures/official-workbooks/hfut-2026')
const raw = readFileSync(join(root, 'original.xlsx')), text = readFileSync(join(root, 'literal-cells.txt'))
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const url = 'https://iec.hfut.edu.cn/_upload/article/files/9e/9f/67156a3c45c59a9de855ea78e4b4/9f36bb18-2f2c-4f99-ad5d-dc7fa9fbc369.xlsx'
const school = { universityId: 'uni-hefei-university-of-technology', name: { en: 'Hefei University of Technology' },
  originalStatus: 'verified', officialHosts: ['iec.hfut.edu.cn'], sourceSeeds: [] } as MaintenanceScope['schools'][number]

/** Synthetic archives exercise the reader, never serve as official source fixtures. */
function zip(files: Record<string, string>): Buffer {
  const members: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name), body = Buffer.from(content), compressed = deflateRawSync(body)
    const local = Buffer.alloc(30), entry = Buffer.alloc(46), sum = crc32(body)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
    local.writeUInt32LE(sum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(filename.length, 26)
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(8, 10)
    entry.writeUInt32LE(sum, 16); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(body.length, 24)
    entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42)
    members.push(local, filename, compressed); central.push(entry, filename)
    offset += local.length + filename.length + compressed.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...members, directory, end])
}
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
function book(): Record<string, string> {
  return {
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Majors" sheetId="1" r:id="r1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst xmlns="${ns}"><si><t>Biomedical Engineering</t><rPh><t>NOT A PROGRAMME</t></rPh></si></sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><r><t>Under</t></r><r><t>graduate</t></r></is></c><c r="C1"><v>1</v></c><c r="D1"/></row></sheetData><mergeCells><mergeCell ref="C1:D1"/></mergeCells></worksheet>`,
  }
}
async function proposal(): Promise<MaintenanceProposal> {
  const fields = { name: { en: 'Biomedical Engineering' }, degreeLevel: 'bachelor', programType: 'degree', programUrl: url,
    internationalAdmissionsEvidence: { sourceId: sha(url), url, snapshotSha256: sha(raw), objectKey: 'raw', locator: 'text:document', quote: '2026 HFUT Undergraduate Majors for International Students' } }
  const value = { id: 'literal-workbook-review', universityId: school.universityId, entityType: 'program', operation: 'patch',
    recordId: 'prog-gap-mve-ecs-hfut-biomedical-engineering-bachelor', status: 'ready', scope: { year: null, intake: null }, fields,
    source: { id: sha(url), url, snapshotSha256: sha(raw), objectKey: 'raw', checkedAt: '2026-10-30T16:16:58.971Z',
      contentType: 'application/vnd.ms-excel;charset=UTF-8', locator: 'text:document', quote: 'Biomedical Engineering',
      textArtifact: { objectKey: 'literal', sha256: sha(text), rawSnapshotSha256: sha(raw), parser: OPENXML_WORKBOOK_PARSER } },
    fieldEvidence: [{ ...fields.internationalAdmissionsEvidence, fieldPath: 'degreeLevel' }], warnings: [],
  } as MaintenanceProposal
  value.review = { decision: 'approved', reviewerId: 'independent-literal-source-review', method: 'deterministic',
    reviewedAt: '2026-10-31T00:00:00.000Z', candidateSha256: await proposalContentSha256(value), snapshotSha256: sha(raw),
    checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true } }
  return maintenanceProposalSchema.parse(value)
}
const readArtifact = async (key: string) => { if (key === 'raw') return raw; if (key === 'literal') return text; throw Error('unregistered_artifact') }

describe('official literal OpenXML programme evidence', () => {
  it('reads the actual complete official attachment and agrees with an independent Python parser', () => {
    expect(sha(raw)).toBe('a288ccc61141f0161eff4dace9314ec1495fe3cf89131a06843f8a24525efd2c')
    const actual = verifyLiteralWorkbookText(raw, text)
    expect(actual.match(/^ROW /gm)).toHaveLength(20)
    expect(actual).toContain('A1=2026 HFUT Undergraduate Majors for International Students')
    expect(actual).toContain('B3=Biomedical Engineering')
    expect(actual).toContain('B20=Financial Engineering')
    const independent = JSON.parse(readFileSync(join(root, 'independent-python-reading.json'), 'utf8'))
    const lines = independent.sheets.flatMap((sheet: { name: string; rows: Array<{ row: number; cells: Array<{ cell: string; literalValue: string }> }> }) => [
      'SHEET ' + sheet.name, ...sheet.rows.map(row => 'ROW ' + row.row + ': ' + row.cells.map(cell => cell.cell + '=' + cell.literalValue).join(' | ')),
    ])
    expect(actual).toBe(lines.join('\n') + '\n')
    expect(independent.sheets[0].rows).toHaveLength(20)
  })
  it('does not fill merged cells, invent numeric codes or include phonetic annotations', () => {
    expect(literalWorkbookText(zip(book()))).toBe('SHEET Majors\nROW 1: A1=Biomedical Engineering | B1=Undergraduate | C1=1 | D1=\n')
  })
  it('accepts the correctly typed actual source through the formal evidence verifier', async () => {
    await expect(verifyReviewedProposalEvidence(await proposal(), school, readArtifact)).resolves.toBeUndefined()
  })
  for (const parser of ['poppler', 'tesseract', 'browser-dom', 'windows-ocr-reviewed-v1', undefined] as const) {
    it(`rejects workbook relabelling as ${parser ?? 'plain HTML'}`, async () => {
      const p = await proposal()
      if (parser) p.source.textArtifact!.parser = parser; else delete p.source.textArtifact
      p.review!.candidateSha256 = await proposalContentSha256(p)
      await expect(verifyReviewedProposalEvidence(p, school, readArtifact)).rejects.toThrow('explicit_workbook_parser_required')
    })
  }
  for (const mutation of [
    ['fabricated programme name', (s: string) => s.replace('Biomedical Engineering', 'Invented Degree')],
    ['truncated rows', (s: string) => s.slice(0, s.indexOf('ROW 20:'))],
    ['missing worksheet', (s: string) => s.replace('SHEET Sheet3\n', '')],
    ['removed parallel language row', (s: string) => s.replace(/^ROW 8:.*\n/m, '')],
    ['filled merged cell', (s: string) => s.replace('E5= |', 'E5=School of Electrical Engineering and Automation |')],
  ] as const) {
    it(`rejects ${mutation[0]} even after the candidate/text fingerprints are resealed`, async () => {
      const changed = Buffer.from(mutation[1](text.toString('utf8'))), p = await proposal()
      p.source.textArtifact!.sha256 = sha(changed); p.review!.candidateSha256 = await proposalContentSha256(p)
      await expect(verifyReviewedProposalEvidence(p, school, async key => key === 'literal' ? changed : readArtifact(key)))
        .rejects.toThrow('literal_projection_mismatch')
    })
  }
  for (const [label, mutate, error] of [
    ['formula cache', (f: Record<string, string>) => { f['xl/worksheets/sheet1.xml'] = f['xl/worksheets/sheet1.xml'].replace('<v>0</v>', '<f>1+1</f><v>0</v>') }, 'cell_identity_or_formula'],
    ['hidden row', (f: Record<string, string>) => { f['xl/worksheets/sheet1.xml'] = f['xl/worksheets/sheet1.xml'].replace('<row r="1">', '<row r="1" hidden="1">') }, 'row_identity_or_state'],
    ['hidden worksheet', (f: Record<string, string>) => { f['xl/workbook.xml'] = f['xl/workbook.xml'].replace('sheetId="1"', 'sheetId="1" state="hidden"') }, 'sheet_identity_or_state'],
    ['external workbook relationship', (f: Record<string, string>) => { f['xl/_rels/workbook.xml.rels'] = f['xl/_rels/workbook.xml.rels'].replace('Id="r1"', 'Id="r1" TargetMode="External"') }, 'workbook_relationship'],
    ['path traversal', (f: Record<string, string>) => { f['../outside.xml'] = '<x/>' }, 'unsafe_zip_member'],
    ['undeclared worksheet', (f: Record<string, string>) => { f['xl/worksheets/sheet2.xml'] = f['xl/worksheets/sheet1.xml'] }, 'undeclared_worksheet'],
    ['invalid shared string', (f: Record<string, string>) => { f['xl/worksheets/sheet1.xml'] = f['xl/worksheets/sheet1.xml'].replace('<v>0</v>', '<v>100</v>') }, 'shared_string_index'],
    ['XML entity', (f: Record<string, string>) => { f['xl/sharedStrings.xml'] = '<!DOCTYPE sst [<!ENTITY injected "x">]>' + f['xl/sharedStrings.xml'] }, 'xml_entities_forbidden'],
    ['macro payload', (f: Record<string, string>) => { f['xl/vbaProject.bin'] = 'executable bytes' }, 'unsupported_workbook_content'],
    ['duplicate cell', (f: Record<string, string>) => { f['xl/worksheets/sheet1.xml'] = f['xl/worksheets/sheet1.xml'].replace('r="D1"', 'r="A1"') }, 'cell_identity_or_formula'],
  ] as const) {
    it(`rejects ${label}`, () => { const files = book(); mutate(files); expect(() => literalWorkbookText(zip(files))).toThrow(error) })
  }
  it('rejects an HTML download error masquerading as a workbook', () => {
    expect(() => literalWorkbookText(Buffer.from('<html>download failed</html>'))).toThrow('zip_directory_missing')
  })
  it('rejects a corrupt CRC', () => {
    const archive = zip(book()), entry = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    archive.writeUInt32LE(123, entry + 16)
    expect(() => literalWorkbookText(archive)).toThrow('zip_crc_or_size')
  })
})
