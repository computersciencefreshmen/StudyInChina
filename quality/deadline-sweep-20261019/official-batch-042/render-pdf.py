"""Only relevant original CUST PDF date/year pages, rendered offline."""
from pathlib import Path
import subprocess,json,hashlib,datetime
ROOT=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
c=next(v for v in json.loads((ROOT/'captures.json').read_text('utf8')) if v['name']=='cust-guide-pdf')
assert sha((ROOT/c['rawPath']).read_bytes())==c['rawSha256'];assert sha((ROOT/c['textPath']).read_bytes())==c['textSha256']
renders=[]
for page in [2,6]:
 out=ROOT/('cust-guide-page-'+str(page))
 subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-singlefile','-scale-to','1600','-png',str(ROOT/c['rawPath']),str(out)],check=True,capture_output=True)
 renders.append({'page':page,'path':out.name+'.png','sha256':sha(Path(str(out)+'.png').read_bytes()),'method':'offline-Poppler-complete-page1600px'})
result={'schemaVersion':1,'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalCapture':c,'networkRequestsForExtractionOrRendering':0,'repeatedOriginalGETs':0,'allPagesTextRead':True,'pageCount':c['pageCount'],'text':{'path':c['textPath'],'sha256':c['textSha256']},'visualPages':renders}
(ROOT/'pdf-offline-extraction.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps({'pageCount':c['pageCount'],'renderedPages':[2,6]}))
