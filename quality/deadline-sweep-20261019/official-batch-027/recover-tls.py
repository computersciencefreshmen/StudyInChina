import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import runpy
import subprocess

ROOT = Path(__file__).resolve().parent
core = runpy.run_path(str(ROOT.parent / 'official-batch-018' / 'capture-current.py'), run_name='capture_helpers')
rows = json.loads((ROOT / 'captures.json').read_text(encoding='utf-8'))
items = [(r['name'] + '-recovery', r['url']) for r in rows if not r['captureSucceeded']]
assert len(items) == 2

def recover(item):
    name, url = item
    row = {'name': name, 'url': url, 'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'method': 'one-bounded-Windows-curl-normal-TLS-recovery', 'tlsCertificateValidation': True}
    raw_path = ROOT / (name + '.html')
    try:
        result = subprocess.run(['curl.exe', '--location', '--fail', '--connect-timeout', '10', '--max-time', '25', '--output', str(raw_path), '--write-out', '%{http_code}\n%{content_type}\n%{url_effective}', url], capture_output=True, text=True, timeout=30)
        row.update({'exitCode': result.returncode, 'responseMetadata': result.stdout})
        if result.returncode != 0:
            raise ValueError(result.stderr[-700:])
        raw = raw_path.read_bytes()
        parser = core['Text']()
        parser.feed(raw.decode('utf-8', errors='replace'))
        body = '\n'.join(' '.join(line.split()) for line in ''.join(parser.parts).splitlines() if line.strip()).encode('utf-8')
        text_path = ROOT / (name + '.txt')
        text_path.write_bytes(body)
        row.update({'rawPath': raw_path.name, 'rawSha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'textPath': text_path.name, 'textSha256': hashlib.sha256(body).hexdigest(), 'captureSucceeded': True})
    except Exception as exc:
        row.update({'captureSucceeded': False, 'error': str(exc), 'retryPolicy': 'cooldown-no-further-retries'})
    return row

with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(recover, items))
(ROOT / 'tls-recoveries.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(results, ensure_ascii=False))
