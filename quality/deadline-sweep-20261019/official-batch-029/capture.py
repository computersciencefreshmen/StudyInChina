import concurrent.futures
import json
from pathlib import Path
import runpy

ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture']
capture.__globals__['ROOT']=ROOT
selection=json.loads((ROOT/'selection.json').read_text(encoding='utf-8'))
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    results=list(pool.map(capture,[(p['key'],p['url']) for p in selection['pages']]))
(ROOT/'captures.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(results,ensure_ascii=False))
