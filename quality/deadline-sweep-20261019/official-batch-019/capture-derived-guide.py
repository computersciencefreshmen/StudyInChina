"""One bounded read of the PDF explicitly embedded in the assigned GDUFE notice."""
import datetime
import hashlib
import json
import urllib.request
from pathlib import Path
from pypdf import PdfReader

root = Path(__file__).resolve().parent
request = json.loads((root / "supplemental-request.json").read_text(encoding="utf-8"))
receipt = {**request, "method": "GET", "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "timeoutSeconds": 20, "maximumBytes": 10485760}
try:
    with urllib.request.urlopen(urllib.request.Request(request["url"], headers={"User-Agent": "Mozilla/5.0"}), timeout=20) as response:
        body = response.read(10485761)
        receipt.update({"httpStatus": response.status, "finalUrl": response.url, "contentType": response.headers.get("Content-Type"), "bytes": len(body)})
    if len(body) > 10485760:
        raise ValueError("Original exceeds 10MiB bound")
    target = root / "gdufe-2026-original-guide.pdf"
    target.write_bytes(body)
    receipt.update({"rawPath": target.name, "rawSha256": hashlib.sha256(body).hexdigest()})
    if not body.startswith(b"%PDF-"):
        raise ValueError("Response is not a PDF original; bytes retained but not date evidence")
    document = PdfReader(target)
    text = "\n".join(f"\n--- PAGE {i + 1} ---\n" + (page.extract_text() or "") for i, page in enumerate(document.pages))
    text_path = root / "gdufe-2026-original-guide.txt"
    text_path.write_text(text, encoding="utf-8")
    receipt.update({"pages": len(document.pages), "textPath": text_path.name, "textSha256": hashlib.sha256(text_path.read_bytes()).hexdigest()})
except Exception as error:
    receipt["error"] = type(error).__name__ + ": " + str(error)
receipt["observedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
(root / "gdufe-2026-original-guide.receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipt, ensure_ascii=False, indent=2))
