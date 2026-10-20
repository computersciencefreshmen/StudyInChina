"""Bounded official-PDF fallback; outputs are confined to this batch directory."""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent
URLS = {
    "blcu": "https://admission.blcu.edu.cn/_upload/article/files/39/74/e89e82e5490687d93679a0c4b3c4/206c8a45-4a29-45e6-9870-cfd697dd5c60.pdf",
    "fudan": "https://ices.fudan.edu.cn/_upload/article/files/9e/6d/2ced2d9b44efbf4f18ad73e0e179/7cb8d8f0-d3cb-436c-87e6-4ffb406b5737.pdf",
    "shu": "https://apply.shu.edu.cn/upload/shangda/7/b/e/%E4%B8%8A%E6%B5%B7%E5%A4%A7%E5%AD%A6%E5%9B%BD%E9%99%85%E9%A2%84%E7%A7%91%E9%A1%B9%E7%9B%AE2027%E5%B9%B4%E6%98%A5%E5%AD%A3%E6%8B%9B%E7%94%9F%E7%AE%80%E7%AB%A0.pdf",
}


def capture(item):
    key, url = item
    receipt = {"key": key, "url": url, "attemptedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/pdf"})
        with urllib.request.urlopen(request, timeout=25) as response:
            body = response.read(10 * 1024 * 1024 + 1)
            receipt.update({"httpStatus": response.status, "finalUrl": response.url, "bytes": len(body)})
        if len(body) > 10 * 1024 * 1024 or not body.startswith(b"%PDF-"):
            raise ValueError("not-a-bounded-pdf")
        target = ROOT / (key + ".pdf")
        target.write_bytes(body)
        receipt.update({"rawPath": target.name, "rawSha256": hashlib.sha256(body).hexdigest()})
        from pypdf import PdfReader
        document = PdfReader(target)
        text = "\n".join(page.extract_text() or "" for page in document.pages)
        text_path = ROOT / (key + ".txt")
        text_path.write_text(text, encoding="utf-8")
        receipt.update({"textPath": text_path.name, "textSha256": hashlib.sha256(text_path.read_bytes()).hexdigest(), "pages": len(document.pages)})
        # The relevant pages can be rendered afterwards once date locations are known.
    except Exception as error:
        receipt["error"] = type(error).__name__ + ": " + str(error)
    return receipt


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    receipts = list(pool.map(capture, URLS.items()))
(ROOT / "pdf-capture-receipts.json").write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipts, ensure_ascii=False, indent=2))
