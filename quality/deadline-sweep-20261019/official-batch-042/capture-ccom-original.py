"""Follow the2026 master wrapper's exact official original link once."""
import json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent;core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers');capture=core['capture'];capture.__globals__['ROOT']=ROOT
p=ROOT/'ccom-original-capture.json'
if p.exists():raise RuntimeError('immutable manifest exists')
rows=[capture(('ccom-master-original','https://www.ccom.edu.cn/info/10711/261321.htm'))]
p.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath']}for r in rows],ensure_ascii=False))
