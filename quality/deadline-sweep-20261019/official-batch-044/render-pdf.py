import concurrent.futures,datetime,hashlib,json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
targets=[('cust-jilin',n) for n in [2,3,5,6]]+[('cuit-guide',n) for n in [1,3,8,9]]
def render(item):
 name,n=item;p=root/(name+'-page-'+str(n));subprocess.run(['pdftoppm','-f',str(n),'-l',str(n),'-singlefile','-scale-to','1600','-png',str(root/(name+'.pdf')),str(p)],check=True,capture_output=True);p=p.with_suffix('.png');return{'original':name+'.pdf','page':n,'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'renderedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'networkRequests':0}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:rows=list(pool.map(render,targets))
(root/'pdf-render-manifest.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8');print('rendered',len(rows))
