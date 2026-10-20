import datetime
import hashlib
import json
from pathlib import Path
import urllib.request
from pypdf import PdfReader

root = Path(__file__).resolve().parent
url = "https://intl-nondegree.tsinghua.edu.cn/b/yzlxs/yz_sys_xxfjb/download/file?id=536584"
receipt = {"url": url, "method": "GET", "discoveredAt": "thu-visiting.html Program Handbook anchor, file id 536584", "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
try:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=25) as response:
        body = response.read(10 * 1024 * 1024 + 1)
        receipt.update({"httpStatus": response.status, "finalUrl": response.url})
    assert len(body) <= 10 * 1024 * 1024 and body.startswith(b"%PDF-")
    target = root / "thu-program-handbook.pdf"
    target.write_bytes(body)
    document = PdfReader(target)
    text = "\n".join(f"\n--- PAGE {i + 1} ---\n" + (page.extract_text() or "") for i, page in enumerate(document.pages))
    (root / "thu-program-handbook.txt").write_text(text, encoding="utf-8")
    receipt.update({"rawPath": target.name, "rawSha256": hashlib.sha256(body).hexdigest(), "bytes": len(body), "pages": len(document.pages),
                    "textPath": "thu-program-handbook.txt", "textSha256": hashlib.sha256((root / "thu-program-handbook.txt").read_bytes()).hexdigest()})
except Exception as error:
    receipt["error"] = type(error).__name__ + ": " + str(error)
receipt["completedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
(root / "thu-program-handbook.receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipt, indent=2))
