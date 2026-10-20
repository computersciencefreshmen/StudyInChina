"""Finite, unauthenticated official-source GETs; immutable raw bytes and receipts."""
import concurrent.futures
import datetime
import hashlib
import json
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
selection = {"pages": json.loads((ROOT / "derived-requests.json").read_text(encoding="utf-8"))}


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.skip = max(0, self.skip - 1)

    def handle_data(self, value):
        if not self.skip and value.strip():
            self.parts.append(value.strip())


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def fetch(item):
    index, page = item
    key = page["key"]
    receipt = {"key": key, "url": page["url"], "method": "GET", "startedAt": now(), "attempt": 1}
    try:
        request = urllib.request.Request(page["url"], headers={"User-Agent": "Mozilla/5.0"})
        try:
            response = urllib.request.urlopen(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read(10 * 1024 * 1024 + 1)
            receipt.update({"httpStatus": response.status, "finalUrl": response.url, "contentType": response.headers.get("Content-Type"), "bytes": len(body)})
        if len(body) > 10 * 1024 * 1024:
            raise ValueError("Body exceeds 10MiB bounded capture")
        suffix = ".pdf" if body.startswith(b"%PDF-") else ".html"
        raw_path = ROOT / (key + suffix)
        raw_path.write_bytes(body)
        receipt.update({"rawPath": raw_path.name, "rawSha256": hashlib.sha256(body).hexdigest()})
        if suffix == ".pdf":
            from pypdf import PdfReader
            document = PdfReader(raw_path)
            text = "\n".join(f"\n--- PAGE {i + 1} ---\n" + (page.extract_text() or "") for i, page in enumerate(document.pages))
            receipt["pages"] = len(document.pages)
        else:
            charset = "utf-8"
            try:
                decoded = body.decode(charset)
            except UnicodeDecodeError:
                charset = "gb18030"
                decoded = body.decode(charset, errors="replace")
            receipt["decodedCharset"] = charset
            parser = Text()
            parser.feed(decoded)
            text = "\n".join(parser.parts)
        text_path = ROOT / (key + ".txt")
        text_path.write_text(text, encoding="utf-8")
        receipt.update({"textPath": text_path.name, "textSha256": hashlib.sha256(text_path.read_bytes()).hexdigest()})
        if receipt["httpStatus"] != 200:
            receipt["error"] = f"HTTP {receipt['httpStatus']} (original response retained)"
    except Exception as error:
        receipt["error"] = type(error).__name__ + ": " + str(error)
    receipt["observedAt"] = now()
    (ROOT / (key + ".receipt.json")).write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return receipt


with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    receipts = list(pool.map(fetch, enumerate(selection["pages"])))
(ROOT / "capture-derived-summary.json").write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipts, ensure_ascii=False, indent=2))
