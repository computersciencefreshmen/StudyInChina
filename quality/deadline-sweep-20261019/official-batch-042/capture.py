"""One bounded GET per exact registered source; prior scope exclusions recorded separately."""
import concurrent.futures,json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent;core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers');capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[('cad-awards','https://chntheatre.edu.cn/cn/liuxue/zhuanye/detail/11795.html'),('ccnu-silk-road','https://cice.ccnu.edu.cn/info/1235/7411.htm'),('ccom-graduate','https://liuxue.ccom.edu.cn/cn/article?cid=167'),('csu-award','https://intl.csu.edu.cn/English/Scholarship/University_Scholarship.htm'),('cust-award','https://sie.cust.edu.cn/scholarship_pages/74616.htm'),('cust-guide-pdf','https://sie.cust.edu.cn/docs/2025-12/4c82fe64bd1e4c75a02b0d4bae45e0b6.pdf'),('csust-award','https://www.csust.edu.cn/gjxy/info/1190/2346.htm'),('csust-awards','https://www.csust.edu.cn/gjxy/ywbwz/Admission/International_Students/Scholarships.htm'),('cuit-language','https://english.cuit.edu.cn/info/1062/1743.htm')]
target=ROOT/'captures.json'
if target.exists():raise RuntimeError('immutable capture manifest exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath']}for r in rows],ensure_ascii=False))
