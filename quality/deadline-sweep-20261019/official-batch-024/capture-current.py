"""One bounded public GET per deduplicated source, normal TLS certificate validation."""
import concurrent.futures
import json
from pathlib import Path
import runpy
ROOT = Path(__file__).resolve().parent
core = runpy.run_path(str(ROOT.parent / "official-batch-018" / "capture-current.py"), run_name="capture_helpers")
capture = core["capture"]
capture.__globals__["ROOT"] = ROOT
SOURCES = [
    ("hzau-scholarship", "https://ic.hzau.edu.cn/ADMISSIONS1/SCHOLARSHIPS/Huazhong_Agricultural_University_Scholarship.htm"),
    ("hzau-application", "https://ic.hzau.edu.cn/ADMISSIONS1/APPLICATION/How_to_Apply.htm"),
    ("hnu-csc-2026", "https://www-en.hnu.edu.cn/__local/E/41/32/CBDFCD7B49E885A62AA9BE4753B_27BDAE72_4851A.pdf"),
    ("hnu-self-financed", "https://www-en.hnu.edu.cn/__local/1/D4/C0/0A6AC6A418F491ADEC7EE62655D_437210C1_5304C.pdf"),
    ("hutb-2026-guide", "https://iec.hutb.edu.cn/xwzx/tzgg/content_90133"),
    ("jsu-president", "https://oec.ujs.edu.cn/en/SCHOLARSHIPS/JSU_Presidential_Scholarship.htm"),
    ("just-2026-guide", "https://admission.just.edu.cn/admissionen/2026/0409/c10152a372095/page.htm"),
    ("jxnu-2026-iclt", "https://laihua.jxnu.edu.cn/2026/0313/c5944a290528/page.htm"),
]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    rows = list(pool.map(capture, SOURCES))
(ROOT / "capture-manifest.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(rows, ensure_ascii=False))
