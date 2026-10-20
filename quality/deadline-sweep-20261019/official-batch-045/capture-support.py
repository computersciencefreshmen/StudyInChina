"""Read only the exact2026 foundation PDF linked in the successful DUT page."""
import json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent;core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers');capture=core['capture'];capture.__globals__['ROOT']=ROOT
p=ROOT/'support-captures.json'
if p.exists():raise RuntimeError('immutable support capture exists')
rows=[capture(('dlut-foundation-pdf','https://sie.dlut.edu.cn/system/_content/download.jsp?urltype=news.DownloadAttachUrl&owner=1894224773&wbfileid=9BF4EE65F024B44DE291C86D0176EAF8'))]
p.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps([{k:v for k,v in r.items() if k in ['name','captureSucceeded','status','bytes','error','rawPath','textPath']}for r in rows],ensure_ascii=False))
