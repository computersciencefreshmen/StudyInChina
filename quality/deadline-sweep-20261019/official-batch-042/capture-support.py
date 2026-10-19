"""One directly linked2026 master guide from the registered CCOM index."""
import json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent;core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers');capture=core['capture'];capture.__globals__['ROOT']=ROOT
p=ROOT/'support-captures.json'
if p.exists():raise RuntimeError('immutable support manifest exists')
rows=[capture(('ccom-master','https://liuxue.ccom.edu.cn/cn/article/detail?cid=167&id=246'))]
p.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath']}for r in rows],ensure_ascii=False))
