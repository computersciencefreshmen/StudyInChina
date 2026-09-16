import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A bounded retrieval of public official material. This records bytes, never approves facts.
const urls = [
  'https://studyathit.hit.edu.cn/ShortwTermPrograms/list.htm',
  'https://lxs.szu.edu.cn/info/1169/6947.htm',
  'https://oec.xmu.edu.cn/en/Program1/Chinese_Language_Programs.htm',
  'https://admission.blcu.edu.cn/en/2026/0303/c1148a3044/page.htm',
  'https://intl-nondegree.tsinghua.edu.cn/f/yzlxs/yz_lxs_kstzb/view?id=264627',
  'https://osao.bfsu.edu.cn/info/2462/6812.htm',
  'https://osao.bfsu.edu.cn/info/2832/5592.htm',
  'https://iie.gdufs.edu.cn/info/1087/1536.htm',
  'https://www.oisa.shisu.edu.cn/index.php/index/newscontent/cid/39/id/666.html',
  'https://iso.fudan.edu.cn/_upload/article/files/ec/db/98f894064930aeeec752ae6440b4/c5ee1e57-ef19-4b80-824e-d52ce48a22b5.pdf',
  'https://admissions.swu.edu.cn/Degree_Programs/Undergraduate/Education.htm',
  'https://pmplatform.chinese.cn/tmp/2026/2/6/94005b2e-f2e9-438e-85e7-12212f0e9968.pdf',
]
const output = resolve(process.argv[2] ?? 'quality/audit-2026-09-16-data-source-receipts.json')
const temporaryDirectory = resolve(process.env.TEMP ?? '.tmp', 'studyinchina-official-audit-2026-09-16')
mkdirSync(temporaryDirectory, { recursive: true })
const receipts = []
for (let offset = 0; offset < urls.length; offset += 3) {
  const batch = await Promise.all(urls.slice(offset, offset + 3).map(async url => {
    const attemptedAt = new Date().toISOString()
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'StudyInChina-SourceAudit/1.0' } })
      const bytes = Buffer.from(await response.arrayBuffer())
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const contentType = response.headers.get('content-type')
      const snapshot = resolve(temporaryDirectory, `${sha256}.${contentType?.includes('pdf') ? 'pdf' : 'html'}`)
      writeFileSync(snapshot, bytes)
      return { url, attemptedAt, receivedAt: new Date().toISOString(), finalUrl: response.url, status: response.status, contentType, byteLength: bytes.length, sha256, localSnapshot: snapshot, factVerification: 'requires_explicit_field_review' }
    } catch (error) {
      return { url, attemptedAt, error: error instanceof Error ? error.message : String(error), factVerification: 'unavailable' }
    }
  }))
  receipts.push(...batch)
  console.log(`Captured ${receipts.length}/${urls.length} official source retrieval receipts.`)
}
writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), note: 'Local temporary snapshots are not a production R2 archival claim. HTTP 200 alone is not fact verification.', receipts }, null, 2)}\n`)
console.log(output)
