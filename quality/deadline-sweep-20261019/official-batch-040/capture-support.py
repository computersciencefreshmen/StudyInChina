"""One directly linked application-list fallback for each current landing page."""
import concurrent.futures,json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[('zstu-applications','https://admission.zstu.edu.cn/Home/Application'),('blcu-graduate-guides','https://admission.blcu.edu.cn/zsjz/list.htm')]
target=ROOT/'support-captures.json'
if target.exists():raise RuntimeError('immutable manifest already exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(rows,ensure_ascii=False))
