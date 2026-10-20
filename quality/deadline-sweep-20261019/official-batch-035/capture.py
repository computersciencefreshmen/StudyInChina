"""Finite free public date-only reads. No canonical writes."""
import concurrent.futures,json,runpy,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[
('shzu-guide','https://ncxy.shzu.edu.cn/2026/0323/c13505a229944/page.htm'),
('smu-apply','https://istudy.smu.edu.cn/pc/applyonline.html'),
('tyut-guide','https://ciee.tyut.edu.cn/__local/9/89/30/60DC7F3929CE9F4C2FADE523955_C8CEC407_43D54F.pdf'),
('tgu-guide','https://en.tiangong.edu.cn/_upload/article/files/28/64/2300c19c414bbe3a237de2c5dfb8/9a9d6103-0dec-488b-9ece-a25dc841375f.pdf'),
('tjufe-guide','https://inter.tjufe.edu.cn/info/1065/1663.htm'),
('tjutcm-guide','https://iec.tjutcm.edu.cn/info/1038/4590.htm'),
('ucas-majors','https://english.ucas.ac.cn/index.php/admission/international-students/major'),
('ucas-guide','https://english.ucas.ac.cn/index.php/admission/international-students/notice/6654-call-for-2026-master-s-doctoral-degree-programs-for-international-students'),
]
target=ROOT/(sys.argv[1] if len(sys.argv)>1 else 'captures.json')
if target.exists():raise RuntimeError('immutable manifest exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(rows,ensure_ascii=False))
