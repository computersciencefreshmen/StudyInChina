import concurrent.futures
import json
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parent
core = runpy.run_path(str(ROOT.parent / 'official-batch-018' / 'capture-current.py'), run_name='capture_helpers')
capture = core['capture']
capture.__globals__['ROOT'] = ROOT
selection = json.loads((ROOT / 'selection.json').read_text(encoding='utf-8'))
names = ['njmu-2026', 'njtech-scholarship', 'nuaa-silkroad-2026', 'njucm-undergraduate', 'nufe-scholarship', 'nufe-programmes', 'njupt-2026', 'njust-bachelor-guide', 'njust-graduate-guide', 'ntu-scholarship']
urls = list(dict.fromkeys(s['row']['url'] for r in selection['records'] for s in r['sources']))
assert len(names) == len(urls) == 10
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    results = list(pool.map(capture, zip(names, urls)))
(ROOT / 'captures.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(results, ensure_ascii=False))
