"""Finite official captures for batch021, reusing the normal-TLS bounded capture helper."""
import concurrent.futures
import json
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parent
core = runpy.run_path(str(ROOT.parent / "official-batch-018" / "capture-current.py"), run_name="capture_helpers")
capture = core["capture"]
capture.__globals__["ROOT"] = ROOT
SOURCES = [
    ("gzhmu-2026-graduate", "https://fao.gzhmu.edu.cn/info/1301/9522.htm"),
    ("gzhu-international-talent", "https://www.gzhu.edu.cn/rcpy1.htm"),
    ("gzhu-handbook", "https://xxgk.gzhu.edu.cn/GJJYXSSC.pdf"),
    ("gzucm-2026-undergraduate", "https://studyoverseas.gzucm.edu.cn/info/1171/2081.htm"),
    ("gzucm-support", "https://studyoverseas.gzucm.edu.cn/__local/B/8A/53/9D531B3B0DC40045B0E47DFD76C_FC43920B_48C18.pdf"),
    ("glmu-2026-programmes", "https://www.glmu.edu.cn/gjjyjlzx/info/1044/2405.htm"),
    ("guet-guide", "https://www.guet.edu.cn/_upload/article/files/53/8a/404dd4d949fd8139bd70861f7dd3/bc7bd8b8-55d6-426a-b4b8-1a2ee168941e.pdf"),
    ("glut-directory", "https://gj.glut.edu.cn/info/1072/2751.htm"),
    ("glut-2026-guide", "https://gj.glut.edu.cn/info/1072/3787.htm"),
]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    rows = list(pool.map(capture, SOURCES))
(ROOT / "capture-manifest.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(rows, ensure_ascii=False))
