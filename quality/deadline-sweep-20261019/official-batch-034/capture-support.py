"""Two linked original bodies, no repeated source GET."""
import concurrent.futures,json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[('suibe-2026-award-pdf','https://www.suibe.edu.cn/_upload/article/files/ad/11/18e1e63442c285036cfffa33f788/ba31c1fd-8a39-4fb7-9547-26e4364f80dc.pdf'),('synu-2026-award','https://cie.synu.edu.cn/2026/0414/c5760a112841/page.htm')]
target=ROOT/'support-captures.json'
if target.exists(): raise RuntimeError('immutable manifest already exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(rows,ensure_ascii=False))
