import concurrent.futures,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
ns={'__file__':str(ROOT/'capture.py'),'__name__':'capture_helpers'}
exec(compile((ROOT.parent/'official-batch-018'/'capture-current.py').read_text(encoding='utf-8'),'shared-capture-helper','exec'),ns)
capture=ns['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[('cust-jilin','https://sie.cust.edu.cn/docs/2026-06/043592cdd3424231b7c80f8e5179d59a.pdf'),('cdut-guide','https://cie.cdut.edu.cn/info/1048/1697.htm'),('caa-guide','https://admission.caa.edu.cn/en/Admissions/CAA_2026_Admission_Guide_for_International_Stude.htm'),('caa-fees','https://admission.caa.edu.cn/en/Admissions/Tuition_and_Fee.htm'),('cfau-csc','https://iss.cfau.edu.cn/col4185/col4274/9cabfdbd76e74c4fa60b06c948b9502f.htm'),('cug-chinalink','https://eniec.cug.edu.cn/info/1053/1395.htm'),('cumtb-csc','https://international.cumtb.edu.cn/info/1037/4071.htm')]
target=ROOT/'captures.json'
if target.exists():raise RuntimeError('immutable manifest exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(rows,ensure_ascii=False))
