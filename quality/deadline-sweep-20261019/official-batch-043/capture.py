"""Single bounded GET per selected official URL without archived same-URL bytes."""
import concurrent.futures,json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[('bfsu-annual','https://osao.bfsu.edu.cn/info/2472/6842.htm'),('bit-awards','https://isc.bit.edu.cn/aboutbit/faq/3714638c555d436b815ec089176975e4.htm'),('blcu-finance','https://admission.blcu.edu.cn/en/384/list.htm'),('bnu-iclt','https://admission-is.bnu.edu.cn/english/international/internationalchinese/index.html'),('bsu-award','https://wsc.bsu.edu.cn/jxj/bjszfjxj/17609.htm'),('bupt-award','https://ois.bupt.edu.cn/Scholarships/Chinese_government_scholarship.htm')]
target=ROOT/'captures.json'
if target.exists():raise RuntimeError('immutable manifest already exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(rows,ensure_ascii=False))
