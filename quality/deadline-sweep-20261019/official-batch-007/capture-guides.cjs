const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const directory = __dirname;
const sources = [
  ['nwpu-master', 'https://studyat.nwpu.edu.cn/info/1303/8791.htm'],
  ['nwpu-doctorate', 'https://studyat.nwpu.edu.cn/info/1313/8831.htm'],
  ['nju-bachelor', 'https://hwxy.nju.edu.cn/lxnd/zsxx/bkxm/sbzn/index.html'],
  ['thu-sigs-guide', 'https://www.sigs.tsinghua.edu.cn/_t195/2026/0918/c7769a293366/page.psp'],
  ['tjfsu-language', 'https://isa.tjfsu.edu.cn/info/1040/1918.htm'],
  ['thu-catalogue', 'https://yzbm.tsinghua.edu.cn/publish/s05/s0503/detail/84682384-10d4-4eb6-9d49-356299983813/1'],
];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (name, bytes) => fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx' });
const allowed = new Set(sources.map(([, url]) => new URL(url).hostname));

async function capture(name, url, init = {}) {
  if (!allowed.has(new URL(url).hostname) || !url.startsWith('https://')) throw Error('unapproved_url');
  const startedAt = new Date().toISOString();
  let receipt;
  try {
    const response = await fetch(url, { ...init, redirect: 'error', cache: 'no-store',
      headers: { accept: 'text/html,application/json', 'user-agent': 'StudyInChina-DateAudit/1.0', ...(init.headers || {}) },
      signal: AbortSignal.timeout(20000) });
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body || []) {
      length += chunk.length;
      if (length > 3 * 1024 * 1024) throw Error('source_body_limit');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const file = name + (init.method === 'POST' ? '.json' : '.html');
    write(file, bytes);
    receipt = { name, url, method: init.method || 'GET', startedAt, completedAt: new Date().toISOString(),
      status: response.status, contentType: response.headers.get('content-type'), bodyPath: file,
      bodySha256: sha(bytes), bytes: bytes.length, requestPurpose: 'Read public official admissions dates only',
      requestBody: init.body || null, canonicalWrites: 0, paidCalls: 0 };
  } catch (error) {
    receipt = { name, url, method: init.method || 'GET', startedAt, completedAt: new Date().toISOString(),
      status: null, failure: String(error.message).split('\n')[0], canonicalWrites: 0, paidCalls: 0 };
  }
  write(name + '.receipt.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ name, status: receipt.status, bytes: receipt.bytes || 0, failure: receipt.failure }));
  return receipt;
}

(async () => {
  // Sequential requests and a domain delay keep this finite source-only capture small.
  for (const [name, url] of sources) {
    await capture(name, url);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  // Same public read-only catalogue query contract as the existing harvester;
  // no login, session cookie, applicant record, model request or canonical write.
  await capture('thu-sigs-public-query', 'https://yzbm.tsinghua.edu.cn/publish/s05/s0503/querydetail', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      referer: sources.at(-1)[1] },
    body: new URLSearchParams({ xxbm: '84682384-10d4-4eb6-9d49-356299983813', zslx: '1', yxsdm: '599', showUsage: 'false' }).toString(),
  });
})().catch(error => { console.error(error.message); process.exitCode = 1; });
