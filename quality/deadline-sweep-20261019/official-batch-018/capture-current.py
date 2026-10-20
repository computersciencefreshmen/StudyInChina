"""One bounded GET per selected public official source; normal TLS; no canonical writes."""
import concurrent.futures
import datetime
import hashlib
import html.parser
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent
SOURCES = [
    ("cuz-2026-undergraduate", "https://sie.cuz.edu.cn/info/1128/5601.htm"),
    ("cuz-scholarship", "https://sie.cuz.edu.cn/English/Application1/Scholarship.htm"),
    ("dlmu-fees", "https://iec.dlmu.edu.cn/English/ADMISSION/FEES.htm"),
    ("dlmu-brochure", "https://iec.dlmu.edu.cn/English/ADMISSION/Admission_Brochure/Admission_Brochure.htm"),
    ("dlmu-preparatory", "https://iec.dlmu.edu.cn/English/ADMISSION/College_Preparatory.htm"),
    ("dlmu-chinese-bachelor", "https://iec.dlmu.edu.cn/English/ADMISSION/Bachelor_s_Degree/Chinese_Taught_Programs.htm"),
    ("dmu-undergraduate", "https://iec.dmu.edu.cn/rxsq_l/Undergraduate_Programs.htm"),
    ("dmu-spring-guide", "https://iec.dmu.edu.cn/info/1012/1638.htm"),
    ("dlufl-2026-undergraduate", "https://scs.dlufl.edu.cn/info/1012/1633.htm"),
    ("dufe-master-programmes", "https://sie.dufe.edu.cn/lxxm/ss/"),
    ("dufe-support-guide", "https://sie.dufe.edu.cn/content_95765.html"),
    ("dgut-business", "https://yjs.dgut.edu.cn/info/1842/21476.htm"),
    ("dgut-software", "https://yjs.dgut.edu.cn/info/1842/21696.htm"),
    ("dgut-2026-master-guide", "https://yjs.dgut.edu.cn/info/1862/21506.htm"),
    ("dgut-2026-faq", "https://yjs.dgut.edu.cn/info/1842/22126.htm"),
]

class Text(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        if tag in ("p", "div", "tr", "td", "h1", "h2", "h3", "br", "li"):
            self.parts.append("\n")
    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        if tag in ("p", "div", "tr", "li"):
            self.parts.append("\n")
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def capture(item):
    name, url = item
    row = {"name": name, "url": url, "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "timeoutSeconds": 25, "maximumBytes": 12_000_000, "tlsCertificateValidation": True}
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; public-admissions-date-check/1.0)", "Accept": "text/html,application/pdf;q=0.9,*/*;q=0.8"})
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = resp.read(12_000_001)
            row.update({"status": resp.status, "finalUrl": resp.url, "contentType": resp.headers.get("Content-Type"), "bytes": len(raw)})
            if len(raw) > 12_000_000:
                raise ValueError("bounded capture maximum exceeded")
            ext = "pdf" if raw.startswith(b"%PDF") else "html"
            raw_path = ROOT / (name + "." + ext)
            raw_path.write_bytes(raw)
            row.update({"rawPath": raw_path.name, "rawSha256": sha(raw)})
            if ext == "pdf":
                from pypdf import PdfReader
                reader = PdfReader(raw_path)
                text = "\n\n".join("=== PAGE %s ===\n%s" % (i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages))
                row["pageCount"] = len(reader.pages)
            else:
                charset = resp.headers.get_content_charset() or "utf-8"
                parser = Text()
                parser.feed(raw.decode(charset, errors="replace"))
                text = "\n".join(" ".join(line.split()) for line in "".join(parser.parts).splitlines() if line.strip())
            encoded = text.encode("utf-8")
            text_path = ROOT / (name + ".txt")
            text_path.write_bytes(encoded)
            row.update({"textPath": text_path.name, "textSha256": sha(encoded), "captureSucceeded": True})
    except Exception as exc:
        row.update({"captureSucceeded": False, "error": str(exc), "retryPolicy": "at-most-one-reasonable-recovery-then-cooldown"})
    return row

if __name__ == "__main__":
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(capture, SOURCES))
    (ROOT / "capture-manifest.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(rows, ensure_ascii=False))
