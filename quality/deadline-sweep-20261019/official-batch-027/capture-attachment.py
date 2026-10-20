import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urljoin
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
html = (ROOT / 'njupt-2026-recovery.html').read_text(encoding='utf-8')
pdfsrc = re.search(r'pdfsrc="([^"]+)"', html).group(1)
url = urljoin('https://overseas.njupt.edu.cn/2025/1027/c4601a290722/page.htm', pdfsrc)
row = {'name': 'njupt-2026-original', 'url': url, 'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'method': 'bounded-native-Windows-curl-normal-TLS-original-PDF', 'tlsCertificateValidation': True, 'parentPage': 'njupt-2026-recovery.html'}
try:
    raw_path = ROOT / 'njupt-2026-original.pdf'
    result = subprocess.run(['curl.exe', '--location', '--fail', '--connect-timeout', '10', '--max-time', '25', '--output', str(raw_path), '--write-out', '%{http_code}\n%{content_type}\n%{url_effective}', url], capture_output=True, text=True, timeout=30)
    row.update({'exitCode': result.returncode, 'responseMetadata': result.stdout})
    if result.returncode != 0:
        raise ValueError(result.stderr[-700:])
    raw = raw_path.read_bytes()
    row.update({'rawPath': raw_path.name, 'rawSha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
    assert raw.startswith(b'%PDF-'), 'Original did not return PDF bytes'
    reader = PdfReader(raw_path)
    body = '\n\n'.join(f'=== PAGE {i + 1} ===\n{p.extract_text() or ""}' for i, p in enumerate(reader.pages)).encode('utf-8')
    text_path = ROOT / 'njupt-2026-original.txt'
    text_path.write_bytes(body)
    row.update({'textPath': text_path.name, 'textSha256': hashlib.sha256(body).hexdigest(), 'pageCount': len(reader.pages), 'captureSucceeded': True})
except Exception as exc:
    row.update({'captureSucceeded': False, 'error': str(exc), 'retryPolicy': 'finite-at-most-one-necessary-fallback-then-cooldown'})
(ROOT / 'embedded-original-capture.json').write_text(json.dumps(row, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(row, ensure_ascii=False))
