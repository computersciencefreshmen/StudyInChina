"""Finite public date-only source reads; normal TLS; canonical workspace read-only."""
import concurrent.futures,json,runpy,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[
('scau-guide','https://gdic.scau.edu.cn/2026/0421/c11155a432798/page.htm'),
('scau-english','https://cie.scau.edu.cn/cie_english/17431/list.htm'),
('scau-admissions','https://cie.scau.edu.cn/zxsqjlc/list.htm'),
('scnu-bachelor','https://english.scnu.edu.cn/a/20260105/1597.html'),
('scnu-master','https://english.scnu.edu.cn/a/20260105/1598.html'),
('scnu-doctorate','https://english.scnu.edu.cn/a/20260105/1599.html'),
('scnu-award','https://english.scnu.edu.cn/a/20260508/1634.html'),
('scut-intensive','https://sie.scut.edu.cn/p1242c1132/list.htm'),
('seu-architecture','https://cis.seu.edu.cn/hwenglish/2009/1222/c2855a30510/page.htm'),
('sustech-global','https://global.sustech.edu.cn/'),
('swpu-guide','https://www.swpu.edu.cn/oice/info/1214/4095.htm'),
('swu-admissions','https://admissions.swu.edu.cn/'),
('swu-education','https://admissions.swu.edu.cn/Degree_Programs/Undergraduate/Education.htm'),
('swu-engineering','https://admissions.swu.edu.cn/Degree_Programs/Postgraduate/Engineering.htm'),
('sysu-guide-pdf','https://iso.sysu.edu.cn/docs/2025-12/20251209183332399352.pdf'),
('sysu-guide','https://iso.sysu.edu.cn/en/application/guide/1420575.htm'),
]
target=ROOT/(sys.argv[1] if len(sys.argv)>1 else 'captures.json')
if target.exists(): raise RuntimeError('immutable capture manifest already exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath']} for r in rows],ensure_ascii=False))
