import json,runpy
from pathlib import Path
root=Path(__file__).resolve().parent
ns={'__file__':str(root/'capture-support.py'),'__name__':'capture_helpers'}
exec(compile((root.parent/'official-batch-018'/'capture-current.py').read_text(encoding='utf-8'),'shared-capture-helper','exec'),ns)
ns['capture'].__globals__['ROOT']=root
target=root/'support-captures.json'
if target.exists():raise RuntimeError('immutable manifest exists')
rows=[ns['capture'](('zjgsu-admissions','https://sie.zjgsu.edu.cn/389/list.htm'))]
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(rows,ensure_ascii=False))
