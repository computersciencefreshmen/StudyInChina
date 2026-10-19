"""One finite official GET per exact source. No canonical writes."""
import concurrent.futures,json,runpy,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[
('ujn-language','https://isao.ujn.edu.cn/English/PROGRAMS/Chinese_Language_and_Culture_Programs.htm'),
('ustc-youth','https://ic.ustc.edu.cn/en/v7list.php?id=646'),
('wmu-brochure','https://sis.wmu.edu.cn/en/Admission/Undergraduate_Program/Admission_Brochure.htm'),
('wzu-china-link','https://cic.wzu.edu.cn/info/1718/11956.htm'),
('wtu-scholarships','https://iec.wtu.edu.cn/info/1060/4292.htm'),
('whu-admission','https://admission.whu.edu.cn/'),
]
target=ROOT/(sys.argv[1] if len(sys.argv)>1 else 'captures.json')
if target.exists():raise RuntimeError('immutable capture manifest already exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath']} for r in rows],ensure_ascii=False))
