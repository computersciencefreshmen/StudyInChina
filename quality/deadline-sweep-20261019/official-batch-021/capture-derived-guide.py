"""Capture the current GLMU applicant guide linked by the registered programme page."""
import concurrent.futures
import json
from pathlib import Path
import runpy
ROOT = Path(__file__).resolve().parent
core = runpy.run_path(str(ROOT.parent / "official-batch-018" / "capture-current.py"), run_name="capture_helpers")
capture = core["capture"]
capture.__globals__["ROOT"] = ROOT
SOURCES = [
    ("glmu-admission-guide-index", "https://www.glmu.edu.cn/gjjyjlzx/zszl/lhlxszsjz.htm"),
    ("glmu-2026-undergraduate-guide", "https://www.glmu.edu.cn/gjjyjlzx/info/1161/2514.htm"),
]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    rows = list(pool.map(capture, SOURCES))
(ROOT / "derived-guide-captures.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(rows, ensure_ascii=False))
