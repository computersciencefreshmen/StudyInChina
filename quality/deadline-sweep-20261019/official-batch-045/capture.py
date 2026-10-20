"""One finite GET per exact registered URL after archived-original scan."""
import concurrent.futures,json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent;core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers');capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[('cupb-language','https://www.cup.edu.cn/overseas/docs/2025-10/8aa73688ac704349918f6cbdfe65b0bf.pdf'),('cupl-bachelor','https://sis.cupl.edu.cn/lhlx/bk.htm'),('cqnu-legacy-language','https://international.cqnu.edu.cn/ywb/info/1373/1303.htm'),('dlmu-award','https://iec.dlmu.edu.cn/English/Scholarship/DMU_Scholarships_.htm'),('dmu-award','https://gjy.dmu.edu.cn/info/1012/1710.htm'),('dlut-foundation','https://sie.dlut.edu.cn/info/3731/21141.htm'),('dlut-support','https://iso.dlut.edu.cn/html/article_content/202511/89A38338906B4A999612DFE1C4653F97.shtml'),('dufe-language','https://sie.dufe.edu.cn/en/studyad/clp/')]
p=ROOT/'captures.json'
if p.exists():raise RuntimeError('immutable capture manifest exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:rows=list(pool.map(capture,SOURCES))
p.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath']}for r in rows],ensure_ascii=False))
