"""Bounded public official-source capture. No catalogue writes; normal TLS validation."""
import concurrent.futures
import datetime
import hashlib
import html.parser
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent
SOURCES = [
    ("csu-2026-english-undergraduate", "https://intl.csu.edu.cn/English/Admission/Undergraduate_Programs/English_taught_Programs.htm"),
    ("cust-partial-software-scholarship", "https://sie.cust.edu.cn/scholarship/52993a71d5524f97a56a8f09828f105a.htm"),
    ("csust-admissions-index", "https://www.csust.edu.cn/gjxy/ywbwz/Admission.htm"),
    ("csust-silk-road-2026-2027", "https://www.csust.edu.cn/gjxy/info/1194/8259.htm"),
    ("cuit-guide", "https://gjjl.cuit.edu.cn/__local/B/63/09/9593ECA72B1551BDAF3BE3A3CDC_C3F5B058_B8FA5.pdf"),
    ("cdut-china-link", "https://cie.cdut.edu.cn/info/1048/1761.htm"),
    ("cdutcm-2026-self-funded", "https://zyd.cdutcm.edu.cn/gjjyxy/zsxx/wjxs/content_113491"),
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
            path = ROOT / (name + ".txt")
            path.write_bytes(encoded)
            row.update({"textPath": path.name, "textSha256": sha(encoded), "captureSucceeded": True})
    except Exception as exc:
        row.update({"captureSucceeded": False, "error": str(exc), "retryPolicy": "cooldown-after-one-bounded-native-recovery-no-endless-retries"})
    return row

if __name__ == "__main__":
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(capture, SOURCES))
    (ROOT / "capture-manifest.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(rows, ensure_ascii=False))
