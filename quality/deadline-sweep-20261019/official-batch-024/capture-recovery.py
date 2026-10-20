"""One Windows TLS-stack recovery per HZAU URL, plus the observed JXNU PDF attachment."""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import runpy
import subprocess
ROOT = Path(__file__).resolve().parent
core = runpy.run_path(str(ROOT.parent / "official-batch-018" / "capture-current.py"), run_name="capture_helpers")
core["capture"].__globals__["ROOT"] = ROOT

def recover(item):
    name, url = item
    row = {"name": name, "url": url, "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "method": "one-bounded-Windows-curl-normal-TLS-recovery", "tlsCertificateValidation": True}
    raw_path = ROOT / (name + ".html")
    try:
        result = subprocess.run(["curl.exe", "--location", "--fail", "--connect-timeout", "10", "--max-time", "25", "--output", str(raw_path), "--write-out", "%{http_code}\n%{content_type}\n%{url_effective}", url], capture_output=True, text=True, timeout=30)
        row["exitCode"] = result.returncode
        row["responseMetadata"] = result.stdout
        if result.returncode != 0:
            raise ValueError(result.stderr[-700:])
        raw = raw_path.read_bytes()
        row.update({"rawPath": raw_path.name, "rawSha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)})
        parser = core["Text"]()
        parser.feed(raw.decode("utf-8", errors="replace"))
        text = "\n".join(" ".join(line.split()) for line in "".join(parser.parts).splitlines() if line.strip()).encode("utf-8")
        text_path = ROOT / (name + ".txt")
        text_path.write_bytes(text)
        row.update({"textPath": text_path.name, "textSha256": hashlib.sha256(text).hexdigest(), "captureSucceeded": True})
    except Exception as exc:
        row.update({"captureSucceeded": False, "error": str(exc), "retryPolicy": "cooldown-no-further-retries"})
    return row

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    futures = [pool.submit(recover, ("hzau-scholarship-recovery", "https://ic.hzau.edu.cn/ADMISSIONS1/SCHOLARSHIPS/Huazhong_Agricultural_University_Scholarship.htm")), pool.submit(recover, ("hzau-application-recovery", "https://ic.hzau.edu.cn/ADMISSIONS1/APPLICATION/How_to_Apply.htm")), pool.submit(core["capture"], ("jxnu-2026-iclt-original", "https://laihua.jxnu.edu.cn/_upload/article/files/a7/45/bf7d0b9e4322b89bc8781f2065b2/1aa93a0b-61e9-46f5-9588-1e8a15aead47.pdf"))]
    rows = [f.result() for f in futures]
(ROOT / "recovery-and-original-manifest.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(rows, ensure_ascii=False))
