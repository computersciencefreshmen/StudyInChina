"""Bounded public primary/fallback notice capture for seven assigned date rows."""
import concurrent.futures
import hashlib
import html
import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
SOURCES = [
    ('hainnu-original', 'https://webplus.hainnu.edu.cn/_s74/2025/1110/c1345a160838/page.psp'),
    ('hainnu-iclt-2026', 'https://gjwh.hainnu.edu.cn/2026/0309/c1348a163203/pagem.htm'),
    ('pku', 'https://www.isd.pku.edu.cn/cn/scholarship/detail.php?id=6'),
    ('sisu-scholarship', 'https://studyinsisu.sisu.edu.cn/jxj/gjzwjsjxj/5e77e5b50f64418eb76adedd432736f9.htm'),
    ('sicnu', 'https://lxs.sicnu.edu.cn/_wx/_wx_home_news_i.aspx?iid=639081519364042574&said=liu'),
    ('cqu', 'https://study.cqu.edu.cn/info/1388/2836.htm'),
    ('sisu-language', 'https://studyinsisu.sisu.edu.cn/zsxx/hyjx/Enzsxx/803062ab33d340748502e1827df80b1a.htm'),
]

def capture(row):
    key, url = row
    result = {'key': key, 'url': url, 'observedAt': datetime.now(timezone.utc).isoformat(), 'method': 'GET'}
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'StudyInChina-Date-Recheck/1.0', 'Accept': 'text/html,application/pdf,image/*'})
        with urllib.request.urlopen(req, timeout=20) as response:
            result.update(httpStatus=response.status, finalUrl=response.url, contentType=response.headers.get('Content-Type'))
            assert urlparse(response.url).hostname == urlparse(url).hostname, 'unexpected_cross_host_redirect'
            raw = response.read(10 * 1024 * 1024 + 1)
            assert len(raw) <= 10 * 1024 * 1024, 'response_size_limit'
            kind = '.pdf' if raw.startswith(b'%PDF-') else '.png' if raw.startswith(b'\x89PNG') else '.jpg' if raw.startswith(b'\xff\xd8') else '.html'
            body = ROOT / (key + kind)
            with body.open('xb') as handle:
                handle.write(raw)
            result.update(bodyPath=body.name, bytes=len(raw), bodySha256=hashlib.sha256(raw).hexdigest())
            if kind == '.html':
                decoded = raw.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
                decoded = re.sub(r'<(script|style)\b[^>]*>[\s\S]*?</\1>', '', decoded, flags=re.I)
                text = html.unescape(re.sub(r'<[^>]+>', '\n', decoded))
                text = '\n'.join(line.strip() for line in text.splitlines() if line.strip())
                with (ROOT / (key + '.txt')).open('x', encoding='utf-8') as handle:
                    handle.write(text + '\n')
                result['textPath'] = key + '.txt'
    except urllib.error.HTTPError as exc:
        result.update(httpStatus=exc.code, error=f'HTTPError:{exc.code}', officialDateVerified=False)
    except Exception as exc:
        result.update(error=f'{type(exc).__name__}:{exc}', officialDateVerified=False)
    return result

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(capture, SOURCES))
    report = {'schemaVersion': 1, 'deduplicatedSourceRequests': len(SOURCES), 'maxConcurrency': 2, 'paidCalls': 0, 'canonicalWrites': 0, 'ccnuSkippedAfterWeb403': True, 'rows': rows}
    with (ROOT / 'captures.json').open('x', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps([{'key': r['key'], 'httpStatus': r.get('httpStatus'), 'bytes': r.get('bytes'), 'error': r.get('error')} for r in rows]))
