import json,runpy
from pathlib import Path
root=Path(__file__).resolve().parent
core=runpy.run_path(str(root.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=root
rows=[capture(('tjufe-attachment','https://inter.tjufe.edu.cn/system/_content/download.jsp?urltype=news.DownloadAttachUrl&owner=1959587954&wbfileid=2312574'))]
target=root/'captures-tjufe-attachment.json'
if target.exists():raise RuntimeError('immutable manifest exists')
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(rows,ensure_ascii=False))
