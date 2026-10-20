import concurrent.futures,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
ns={'__file__':str(ROOT/'capture.py'),'__name__':'capture_helpers'}
exec(compile((ROOT.parent/'official-batch-018'/'capture-current.py').read_text(encoding='utf-8'),'shared-capture-helper','exec'),ns)
capture=ns['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[('bsu','https://zs.bsu.edu.cn/docs/2025-11/42eac512d5c34329afba9e0b37abad2b.pdf'),('btbu','https://gjjy.btbu.edu.cn/lhlxs/lhlxszsxx/8ad1beb8499844b4b89a7bdcc41b1e18.htm'),('bjut','https://isa.bjut.edu.cn/__local/C/5B/8A/281F6B1C10341C2FF785EEFE956_1A4C4532_5675A.pdf'),('bwu-awards','https://is.bwu.edu.cn/info/1189/2933.htm'),('bwu-rule','https://is.bwu.edu.cn/beijingwuzixueyuanwaiguoliuxueshengjiangxuejinguanlibanfa.pdf'),('cueb-award','https://sie.cueb.edu.cn/Eng/scholarships/cuebscholarship/index.htm')]
target=ROOT/'captures.json'
if target.exists():raise RuntimeError('immutable manifest exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(rows,ensure_ascii=False))
