"""Bounded official GETs; no canonical or credential access."""
import concurrent.futures, json, runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[
('nwnu-guide','https://foreign.nwnu.edu.cn/_upload/article/files/66/4f/c8d47d9442ac899699e18a345813/7bddafdb-6a71-476e-adb7-8d12200bfb0c.pdf'),
('shcm-guide','https://yjsb.shcmusic.edu.cn/_upload/article/files/1b/ec/b0ca02bc4d6fba1d5f980afbec4c/d27c9cc3-4989-4a24-8a99-9c9edf60fa4d.pdf'),
('sta-guide','https://iso.sta.edu.cn/_upload/article/files/b8/e7/781f2e5a4602b245a6be0e949646/8773afff-c435-482b-8605-26f0a88ea189.pdf'),
('suep-guide','https://fao.shiep.edu.cn/_upload/article/files/5a/08/9d8d7e404f879c420bed0297b055/261babb3-636a-4aa3-a43c-13ed593abddc.pdf'),
('sufe-guide','https://intlstu.sufe.edu.cn/2e/f4/c12486a208628/page.htm'),
('shupl-guide','https://iso.shupl.edu.cn/2025/1029/c3326a143594/page.htm'),
('shupl-belt-road','https://iso.shupl.edu.cn/english/2017/0420/c3363a145473/page.htm'),
]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: rows=list(pool.map(capture,SOURCES))
(ROOT/'captures.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath']} for r in rows],ensure_ascii=False))
