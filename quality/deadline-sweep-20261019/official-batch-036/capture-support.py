"""One bounded linked recovery per incomplete original source; no canonical writes."""
import concurrent.futures,json,runpy,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[
('ujn-year-programme','https://isao.ujn.edu.cn/info/1048/1242.htm'),
('ustc-admissions','https://ic.ustc.edu.cn/?page_id=747'),
('wtu-guide-pdf','https://iec.wtu.edu.cn/__local/F/BC/0D/6385D4717C93E79E9E89CAB90CE_278641AD_A7365E.pdf'),
('whu-scholarships','https://admission.whu.edu.cn/ADMISSION/SCHOLARSHIPS.htm'),
]
target=ROOT/'support-captures.json'
if target.exists():raise RuntimeError('immutable support capture manifest already exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath']} for r in rows],ensure_ascii=False))
