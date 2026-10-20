"""Single finite public official GET per registered URL; no canonical writes."""
import concurrent.futures,json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[('whut-guide','https://sie.whut.edu.cn/english/ist/unde/202602/t20260227_1385160.shtml'),('xisu-language','https://six.xisu.edu.cn/lxxwywz/Admissions/Chinese_Programs/Regular_Chinese_Language_Program.htm'),('xaut-admissions','https://oice.xaut.edu.cn/lhlxs/zsjz_br_Admissions.htm'),('xaut-majors','https://oice.xaut.edu.cn/lhlxs/zysz_Major_List.htm'),('xtu-bachelor','https://en.xtu.edu.cn/Admissions/International_Programs/Bachelor_Programs.htm'),('xtu-guide','https://gjjlc.xtu.edu.cn/info/1024/2754.htm'),('xjau-guide-pdf','https://cie.xjau.edu.cn/_upload/article/files/82/2f/97478cf44d7799e481014ed1192e/57311611-14bb-4339-ad62-fb264298c9ee.pdf'),('xjau-guide','https://cie.xjau.edu.cn/2026/0319/c1288a113905/pagem.htm'),('xzhmu-guide','https://gjjy.xzhmu.edu.cn/info/1010/2412.htm'),('xtu-award','https://gjjlc.xtu.edu.cn/info/1024/2752.htm')]
target=ROOT/'captures.json'
if target.exists(): raise RuntimeError('immutable capture manifest already exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath','pageCount']} for r in rows],ensure_ascii=False))
