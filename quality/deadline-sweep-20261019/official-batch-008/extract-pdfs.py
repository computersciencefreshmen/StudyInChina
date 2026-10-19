"""Extract the already captured official PDFs without any further network read."""
import hashlib
import json
from pathlib import Path
from pypdf import PdfReader

root = Path(__file__).resolve().parent
receipts = json.loads((root / "pdf-capture-receipts.json").read_text(encoding="utf-8"))
for receipt in receipts:
    target = root / receipt["rawPath"]
    assert hashlib.sha256(target.read_bytes()).hexdigest() == receipt["rawSha256"]
    document = PdfReader(target)
    text = "\n".join(f"\n--- PAGE {index + 1} ---\n" + (page.extract_text() or "") for index, page in enumerate(document.pages))
    text_path = root / (receipt["key"] + ".txt")
    text_path.write_text(text, encoding="utf-8")
    receipt.update({"extractionErrorResolvedWith": "pypdf", "textPath": text_path.name,
                    "textSha256": hashlib.sha256(text_path.read_bytes()).hexdigest(), "pages": len(document.pages)})
    print(receipt["key"], "pages", len(document.pages), "textCharacters", len(text))
(root / "pdf-readable-captures.json").write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
