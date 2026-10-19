"""Finite exact public official-source GETs; BFSU archived bytes are checked separately."""
import concurrent.futures,json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers');capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[('zju-admissions','https://iczu.zju.edu.cn/admissionsen/'),('zufe-programme','https://english.zufe.edu.cn/Study_at_ZUFE/Admissions_and_Majors/Undergraduate_Program.htm'),('zufe-application','https://english.zufe.edu.cn/Study_at_ZUFE/Application.htm'),('zzu-medical-foundation','https://international.zzu.edu.cn/en/admission/detail?cid=17&detail=612&pid=0&spid=0'),('zzu-support','https://international.zzu.edu.cn/en/article/detail?cid=53&detail=64&pid=53'),('zuel-guide','https://ies-en.zuel.edu.cn/_upload/article/files/9e/a1/f493cff64425b1bbf55d031a056b/283f0e72-29f6-4dc8-b85d-4e400c5c50f9.pdf'),('zjut-freshman','https://www.gjxy.zjut.edu.cn/index.php/en/prospectivestudents/undergraduate'),('ahmu-award','https://english.ahmu.edu.cn/5316/list.htm')]
target=ROOT/'captures.json'
if target.exists():raise RuntimeError('immutable capture manifest exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath']}for r in rows],ensure_ascii=False))
