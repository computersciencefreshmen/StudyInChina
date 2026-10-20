import concurrent.futures,datetime,hashlib,json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
targets=[('yangtze-guide',n) for n in [1,13,18,19]]+[('yzu-software',1)]+[('ytu-language',n) for n in [1,3,8]]+[('ynnu-majors',1)]+[('ynufe-language',n) for n in [1,4,5,8]]
def render(item):
 name,n=item;prefix=root/(name+'-page-'+str(n));subprocess.run(['pdftoppm','-f',str(n),'-l',str(n),'-singlefile','-scale-to','1600','-png',str(root/(name+'.pdf')),str(prefix)],check=True,capture_output=True);p=prefix.with_suffix('.png');return{'original':name+'.pdf','page':n,'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'renderedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'Poppler-complete-page-1600px-offline','networkRequests':0}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:rows=list(pool.map(render,targets))
(root/'pdf-render-manifest.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8');print(json.dumps(rows))
