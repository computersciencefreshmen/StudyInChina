"""Three bounded supporting-source reads. No repeated BFSU archived read exists for this exact URL."""
import concurrent.futures,json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent;core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers');capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[('bfsu-undergraduate','https://osao.bfsu.edu.cn/info/2612/7182.htm'),('zufe-bulletin-pdf','https://english.zufe.edu.cn/system/_content/download.jsp?urltype=news.DownloadAttachUrl&owner=1721710842&wbfileid=16478297'),('zju-scholarships','https://iczu.zju.edu.cn/admissionsen/wcholarships/list.htm')]
target=ROOT/'support-captures.json'
if target.exists():raise RuntimeError('immutable manifest exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath']}for r in rows],ensure_ascii=False))
