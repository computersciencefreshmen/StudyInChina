"""Finite free official GETs. 25-second timeout, 40 MB bound, normal TLS."""
import concurrent.futures,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
namespace={'__file__':str(ROOT/'capture.py'),'__name__':'capture_helpers'}
source=(ROOT.parent/'official-batch-018'/'capture-current.py').read_text(encoding='utf-8').replace('12_000_001','40_000_001').replace('12_000_000','40_000_000')
exec(compile(source,'shared-capture-helper','exec'),namespace)
capture=namespace['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[
('yangtze-guide','https://english.yangtzeu.edu.cn/__local/B/51/C0/856061AE5D14793B86CB5604ADF_AFA65F71_17637D5.pdf'),
('yzu-software','https://coe.yzu.edu.cn/__local/3/48/9C/C8365844700F1C231B229D9A08A_36C980A7_2E6EF.pdf'),
('ytu-language','https://isc.ytu.edu.cn/chi.pdf'),
('ynnu-majors','https://lx.ynnu.edu.cn/shuoshizhuanyeyingwen2026.pdf'),
('ynnu-guide','https://lx.ynnu.edu.cn/info/1286/1335.htm'),
('ynufe-language','https://www.ynufe.edu.cn/__local/4/E5/12/54FC29EDC7F61029118F35ACD24_ED2591FF_2EEB4.pdf'),
('zjgsu-home','https://sie.zjgsu.edu.cn/'),
]
target=ROOT/'captures.json'
if target.exists():raise RuntimeError('immutable capture manifest already exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(rows,ensure_ascii=False))
