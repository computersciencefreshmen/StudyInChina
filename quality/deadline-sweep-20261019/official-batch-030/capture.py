"""Finite official date-only source reads. No credential or canonical access."""
import concurrent.futures, json, runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture']; capture.__globals__['ROOT']=ROOT
SOURCES=[
 ('sdjzu-scholarship','https://www.sdjzu.edu.cn/english/International_Admissions/Academic_Education/Scholarship_policy.htm'),
 ('sdjzu-policy','https://www.sdjzu.edu.cn/xxgk/info/1090/3109.htm'),
 ('sdjzu-admissions','https://www.sdjzu.edu.cn/gjjy/info/1027/1173.htm'),
 ('sdnu-iclt','https://www.cie.sdnu.edu.cn/lxsgz/jxj/kzxyjxj/xsjxjxm.htm'),
 ('sdu-csc','https://istudy.sdu.edu.cn/info/1291/3949.htm'),
 ('sdufe-undergraduate','https://study.sdufe.edu.cn/info/1007/1054.htm'),
 ('sdutcm-guide','https://gjjiaoyu.sdutcm.edu.cn/info/1158/2261.htm'),
 ('lixin-scholarship','https://en.lixin.edu.cn/Scholarship/list.htm'),
 ('shmtu-scholarship','https://en.shmtu.edu.cn/SGSScholarship/main.psp'),
 ('shou-csc','https://ieo.shou.edu.cn/2025/1126/c18223a348600/page.htm'),
]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: rows=list(pool.map(capture,SOURCES))
(ROOT/'captures.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath']} for r in rows],ensure_ascii=False))
