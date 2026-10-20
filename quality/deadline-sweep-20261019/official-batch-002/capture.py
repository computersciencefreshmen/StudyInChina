"""Bounded, free, public-source date recheck; writes evidence in this batch only."""
import concurrent.futures
import hashlib
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
import urllib.request

ROOT = Path(__file__).resolve().parent
SOURCES = [
    ('sjtu', 'https://isc.sjtu.edu.cn/kindeditor/Upload/file/20260325/20260325161952_0808.pdf'),
    ('dut', 'https://sie.dlut.edu.cn/English/Scholarship1/CIS_Scholarship/CIS_Scholarship.htm'),
    ('shnu', 'https://iao.shnu.edu.cn/ec/35/c20435a846901/page.htm'),
    ('blcu', 'https://admission.blcu.edu.cn/en/2026/0303/c1148a3044/page.htm'),
    ('xmu', 'https://admissions.xmu.edu.cn/info/1061/4020.htm'),
    ('dhu', 'https://english.dhu.edu.cn/_t1264/2021/0119/c5221a273256/page.psp'),
    ('xju', 'https://gjjl.xju.edu.cn/info/1015/2558.htm'),
    ('snnu', 'https://study.snnu.edu.cn/info/1066/1238.htm'),
    ('shu', 'https://apply.shu.edu.cn/upload/shangda/2/c/0/Application%20Guide%20for%20International%20Chinese%20Language%20Teachers%20Scholarship%20of%20Shanghai%20University%202026.pdf'),
    ('nankai', 'https://ensie.nankai.edu.cn/info/1043/1317.htm'),
]
assert len(SOURCES) == len({url for _, url in SOURCES}) == 10

def fetch(row):
    key, url = row
    result = {'key': key, 'url': url, 'observedAt': datetime.now(timezone.utc).isoformat(), 'method': 'GET', 'paidCalls': 0}
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'StudyInChina-Date-Recheck/1.0', 'Accept': 'text/html,application/pdf'})
        with urllib.request.urlopen(request, timeout=25) as response:
            result.update(status=response.status, finalUrl=response.url, contentType=response.headers.get('Content-Type'))
            if urlparse(response.url).hostname != urlparse(url).hostname:
                raise ValueError('cross-host redirect not admitted')
            raw = response.read(5 * 1024 * 1024 + 1)
            if len(raw) > 5 * 1024 * 1024:
                raise ValueError('body size limit exceeded')
            suffix = '.pdf' if raw.startswith(b'%PDF-') else '.html'
            destination = ROOT / (key + suffix)
            with destination.open('xb') as handle:
                handle.write(raw)
            result.update(bodyPath=destination.name, bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
            if suffix == '.html':
                text = raw.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
                text = re.sub(r'<(script|style)\b[^>]*>[\s\S]*?</\1>', '', text, flags=re.I)
                text = html.unescape(re.sub(r'<[^>]+>', '\n', text))
                text = '\n'.join(line.strip() for line in text.splitlines() if line.strip())
                with (ROOT / (key + '.txt')).open('x', encoding='utf-8') as handle:
                    handle.write(text + '\n')
                result['textPath'] = key + '.txt'
    except Exception as exc:
        result['error'] = f'{type(exc).__name__}: {exc}'
        result['officialDateVerified'] = False
    return result

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(fetch, SOURCES))
    report = {'schemaVersion': 1, 'purpose': 'official-date-only-capture', 'maxSources': 10, 'maxConcurrency': 2, 'paidCalls': 0, 'canonicalWrites': 0, 'rows': rows}
    with (ROOT / 'captures.json').open('x', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps([{'key': row['key'], 'status': row.get('status'), 'bytes': row.get('bytes'), 'error': row.get('error')} for row in rows], ensure_ascii=False))
