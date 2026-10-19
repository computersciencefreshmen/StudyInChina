"""Bounded current official reads. WKU cooldown and SIGS prior evidence are not re-fetched."""
import concurrent.futures
import datetime
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent
URLS = {
    "fudan-winter": "https://iss.fudan.edu.cn/Winter/Application.htm",
    "ruc-nondegree": "https://iso.ruc.edu.cn/docs/2025-12/b911becc69294e3ebd5b337c5fbe70e4.pdf",
    "thu-visiting": "https://intl-nondegree.tsinghua.edu.cn/f/yzlxs/yz_lxs_kstzb/view?id=264627",
}


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.chunks = []

    def handle_data(self, value):
        if value.strip():
            self.chunks.append(value.strip())


def fetch(item):
    key, url = item
    receipt = {"key": key, "url": url, "method": "GET", "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=25) as response:
            body = response.read(10 * 1024 * 1024 + 1)
            receipt.update({"httpStatus": response.status, "finalUrl": response.url, "contentType": response.headers.get("Content-Type"), "bytes": len(body)})
        assert len(body) <= 10 * 1024 * 1024
        suffix = ".pdf" if body.startswith(b"%PDF-") else ".html"
        (ROOT / (key + suffix)).write_bytes(body)
        receipt.update({"rawPath": key + suffix, "rawSha256": hashlib.sha256(body).hexdigest()})
        if suffix == ".pdf":
            from pypdf import PdfReader
            document = PdfReader(ROOT / receipt["rawPath"])
            text = "\n".join(f"\n--- PAGE {index + 1} ---\n" + (page.extract_text() or "") for index, page in enumerate(document.pages))
            receipt["pages"] = len(document.pages)
        else:
            parser = Text()
            parser.feed(body.decode("utf-8", errors="replace"))
            text = "\n".join(parser.chunks)
        (ROOT / (key + ".txt")).write_text(text, encoding="utf-8")
        receipt.update({"textPath": key + ".txt", "textSha256": hashlib.sha256((ROOT / (key + ".txt")).read_bytes()).hexdigest()})
    except Exception as error:
        receipt["error"] = type(error).__name__ + ": " + str(error)
    receipt["completedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return receipt


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    receipts = list(pool.map(fetch, URLS.items()))
(ROOT / "current-capture-receipts.json").write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipts, ensure_ascii=False, indent=2))
