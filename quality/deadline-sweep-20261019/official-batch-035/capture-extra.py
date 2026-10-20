import json,runpy
from pathlib import Path
root=Path(__file__).resolve().parent
core=runpy.run_path(str(root.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=root
rows=[capture(('tyut-award','https://ciee.tyut.edu.cn/info/1016/3436.htm'))]
(root/'captures-extra.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(rows,ensure_ascii=False))
