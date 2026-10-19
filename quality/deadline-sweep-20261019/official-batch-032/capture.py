"""Finite public official date-only source GETs. No canonical writes."""
import concurrent.futures, json, runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture']; capture.__globals__['ROOT']=ROOT
SOURCES=[
 ('sxu-foundation','https://siee.sxu.edu.cn/docs/2026-04/9e9a1838ee3e49c3aabd942d05cd4e32.pdf'),
 ('syphu-degree','https://en.syphu.edu.cn/Admissions/Degree_Programs.htm'),
 ('syphu-requirements','https://en.syphu.edu.cn/Admissions/Admission_Requirement.htm'),
 ('sztu-admission','https://english.sztu.edu.cn/INTERNATIONAL_STUDENTS/Degree_Program1/Admission.htm'),
 ('sztu-procedure','https://english.sztu.edu.cn/INTERNATIONAL_STUDENTS/Degree_Program1/Application_Procedure.htm'),
 ('sicau-undergraduate','https://ic.sicau.edu.cn/info/1082/1461.htm'),
 ('scfai-doctoral','https://www.scfai.edu.cn/gjjl/info/1013/2402.htm'),
 ('scfai-master','https://www.scfai.edu.cn/gjjl/info/1013/2392.htm'),
 ('scfai-bachelor','https://www.scfai.edu.cn/gjjl/info/1013/2382.htm'),
 ('scu-international','https://global.scu.edu.cn/'),
]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: rows=list(pool.map(capture,SOURCES))
(ROOT/'captures.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(rows,ensure_ascii=False))
