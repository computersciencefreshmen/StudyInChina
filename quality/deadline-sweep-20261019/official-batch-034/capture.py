"""Finite public official date-only reads; canonical workspace read-only."""
import concurrent.futures,json,runpy,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[
('hit-award-source','https://studyathit.hit.edu.cn/'),
('nju-award-source','https://hwxy.nju.edu.cn/English/'),
('suibe-awards','https://www.suibe.edu.cn/sis/jxjsz_17118/list.psp'),
('suibe-2026-award','https://www.suibe.edu.cn/wsc/2025/1229/c19498a192095/page.htm'),
('stu-award','https://sie.stu.edu.cn/study.aspx?flowNo=11'),
('sxtcm-undergraduate','https://gjzx.sxtcm.edu.cn/info/1079/1997.htm'),
('sxtcm-master','https://gjzx.sxtcm.edu.cn/info/1079/1998.htm'),
('sau-award','https://en.sau.edu.cn/Admission/Scholarship/Liaoning_Provincial_Government_Scholarship.htm'),
('synu-admissions','https://cie.synu.edu.cn/zsjz/list.htm'),
]
target=ROOT/(sys.argv[1] if len(sys.argv)>1 else 'captures.json')
if target.exists(): raise RuntimeError('immutable capture manifest already exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath']} for r in rows],ensure_ascii=False))
