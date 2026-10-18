"""Freshly capture the seven exact official BLCU sources referenced by the recovered candidate."""
import importlib.util
import json
from pathlib import Path
import sys

workspace=Path.cwd()
helper=workspace/'quality/recovery-20261018/official/shu/capture_official.py'
spec=importlib.util.spec_from_file_location('official_capture',helper)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.BASE=workspace/'quality/recovery-20261018/official'
source_rows=json.loads((workspace/'quality/recovery-20261018/remote-wave-2/content/data/sources.json').read_text(encoding='utf-8'))
keys={
 'source-blcu-map-undergraduate-2027-20261017':'blcu-notice-2027',
 'source-blcu-map-undergraduate-2027-catalogue-v2-20261017':'blcu-catalogue-2027',
 'source-blcu-map-undergraduate-entry-20261017':'blcu-entry',
 'source-blcu-map-chinese-programmes-list-official-20261017':'blcu-chinese-medium-list',
 'source-blcu-map-chinese-bachelor-profile-20261017':'blcu-chinese-profile',
 'source-blcu-map-teaching-chinese-bachelor-profile-20261017':'blcu-tcsol-profile',
 'source-blcu-map-application-portal-20261017':'blcu-apply',
}
selected={s['id']:s for s in source_rows if s['id'] in keys}
if set(selected)!=set(keys):raise ValueError('Missing exact candidate source')
module.SOURCES={keys[k]:('blcu',s['url'],'pdf' if s['url'].endswith('.pdf') else 'html') for k,s in selected.items()}
original_get=module.get
def strict_get(url,host,maximum):
    result,raw=original_get(url,host,maximum)
    if url.endswith('/robots.txt') and 200<=result['status']<300 and b'<html' in raw.lower():
        raise ValueError('robots_invalid_html; no bypass')
    return result,raw
module.get=strict_get
for source_id,name in keys.items():
    sys.argv=[str(helper),name]
    try: module.main()
    except Exception as exc: print(json.dumps({'capture':name,'held':True,'reason':str(exc)},ensure_ascii=False))
