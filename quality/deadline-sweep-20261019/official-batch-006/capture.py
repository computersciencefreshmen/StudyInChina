"""One bounded public GET per XMU degree guide. No canonical/Git/cloud writes."""
import hashlib
import html
import json
import re
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GUIDES = {
    'bachelor': 'https://admissions.xmu.edu.cn/cn/info/1063/10733.htm',
    'master': 'https://admissions.xmu.edu.cn/cn/info/1063/10743.htm',
    'doctorate': 'https://admissions.xmu.edu.cn/cn/info/1063/10753.htm',
}

class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.tables = []
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            if self.depth == 0:
                self.rows = []
            self.depth += 1
        elif self.depth and tag == 'tr':
            self.row = []
        elif self.depth and tag in ('td', 'th'):
            attributes = dict(attrs)
            self.cell = {'tag': tag, 'rowspan': int(attributes.get('rowspan', '1')), 'colspan': int(attributes.get('colspan', '1')), 'parts': []}

    def handle_data(self, data):
        if self.cell is not None:
            self.cell['parts'].append(data)

    def handle_endtag(self, tag):
        if self.depth and tag in ('td', 'th') and self.cell is not None:
            self.cell['text'] = re.sub(r'\s+', ' ', ''.join(self.cell.pop('parts'))).strip()
            self.row.append(self.cell)
            self.cell = None
        elif self.depth and tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None
        elif tag == 'table':
            self.depth -= 1
            if self.depth == 0:
                self.tables.append(self.rows)

def capture(level, url):
    result = {'degreeLevel': level, 'url': url, 'observedAt': datetime.now(timezone.utc).isoformat(), 'method': 'GET'}
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'StudyInChina-Date-Recheck/1.0', 'Accept': 'text/html'})
        with urllib.request.urlopen(request, timeout=20) as response:
            assert response.url == url, 'unexpected_redirect'
            raw = response.read(2 * 1024 * 1024 + 1)
            assert len(raw) <= 2 * 1024 * 1024, 'response_size_limit'
            with (ROOT / f'{level}.html').open('xb') as handle:
                handle.write(raw)
            decoded = raw.decode(response.headers.get_content_charset() or 'utf-8')
            parser = Tables()
            parser.feed(decoded)
            candidates = [table for table in parser.tables if any('截止时间' in cell['text'] for row in table for cell in row) and any('自费生' in cell['text'] for row in table for cell in row)]
            assert len(candidates) == 1, 'unique_application_dates_table_required'
            table_path = f'{level}-date-table.json'
            with (ROOT / table_path).open('x', encoding='utf-8') as handle:
                json.dump(candidates[0], handle, ensure_ascii=False, indent=2)
                handle.write('\n')
            decoded = re.sub(r'<(script|style)\b[^>]*>[\s\S]*?</\1>', '', decoded, flags=re.I)
            text = html.unescape(re.sub(r'<[^>]+>', '\n', decoded))
            text = '\n'.join(line.strip() for line in text.splitlines() if line.strip())
            with (ROOT / f'{level}.txt').open('x', encoding='utf-8') as handle:
                handle.write(text + '\n')
            result.update(httpStatus=response.status, finalUrl=response.url, bodyPath=f'{level}.html', bodySha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw), textPath=f'{level}.txt', dateTablePath=table_path, dateTableSha256=hashlib.sha256((ROOT / table_path).read_bytes()).hexdigest())
    except Exception as exc:
        result['error'] = f'{type(exc).__name__}: {exc}'
        result['officialDateVerified'] = False
    return result

if __name__ == '__main__':
    rows = [capture(level, url) for level, url in GUIDES.items()]
    report = {'schemaVersion': 1, 'purpose': 'XMU2027-degree-official-full-guide-capture', 'deduplicatedSourceRequests': 3, 'concurrency': 1, 'paidCalls': 0, 'canonicalWrites': 0, 'rows': rows}
    with (ROOT / 'captures.json').open('x', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps([{'level': row['degreeLevel'], 'status': row.get('httpStatus'), 'bytes': row.get('bytes'), 'error': row.get('error')} for row in rows]))
