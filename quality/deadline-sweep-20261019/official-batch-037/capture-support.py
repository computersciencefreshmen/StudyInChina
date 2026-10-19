"""Bounded linked originals and one XJAU invalid-mobile-page recovery."""
import concurrent.futures,json,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=ROOT
SOURCES=[('xzhmu-guide-pdf','https://gjjy.xzhmu.edu.cn/__local/3/F5/8E/6214DD9FFBE48F60FC6B6711547_773C26F0_34CAF.pdf'),('xjau-guide-fallback','https://cie.xjau.edu.cn/2026/0319/c1288a113905/page.htm'),('xtu-2026-bachelor-catalogue','https://gjjlc.xtu.edu.cn/system/_content/download.jsp?urltype=news.DownloadAttachUrl&owner=1699072544&wbfileid=14896243')]
target=ROOT/'support-captures.json'
if target.exists(): raise RuntimeError('immutable capture manifest already exists')
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: rows=list(pool.map(capture,SOURCES))
target.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(rows,ensure_ascii=False))
