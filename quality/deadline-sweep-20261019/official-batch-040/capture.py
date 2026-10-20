"""Only registered URLs without a same-URL archived original; finite normal-TLS reads."""
import concurrent.futures,json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[('zstu-home','https://admission.zstu.edu.cn/'),('bisu-award-pdf','https://admission.bisu.edu.cn/module/download/downfile.jsp?classid=0&filename=2311091107332343603.pdf'),('bisu-guide-pdf','https://admission.bisu.edu.cn/module/download/downfile.jsp?classid=0&filename=2403220938594699584.pdf'),('bisu-home','https://admission.bisu.edu.cn/'),('blcu-home','https://admission.blcu.edu.cn/')]
target=ROOT/'captures.json'
if target.exists():raise RuntimeError('immutable capture manifest already exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(rows,ensure_ascii=False))
