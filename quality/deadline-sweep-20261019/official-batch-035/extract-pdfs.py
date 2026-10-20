from pathlib import Path
from pypdf import PdfReader
import hashlib,json
root=Path(__file__).resolve().parent
rows=[]
for name in ['tyut-guide','tgu-guide']:
 p=root/(name+'.pdf');r=PdfReader(p);text='\n\n'.join('=== PAGE %s ===\n%s'%(i+1,page.extract_text() or '') for i,page in enumerate(r.pages));b=text.encode('utf-8');(root/(name+'.txt')).write_bytes(b);rows.append({'name':name,'rawSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'textPath':name+'.txt','textSha256':hashlib.sha256(b).hexdigest(),'pageCount':len(r.pages),'method':'bundled-runtime-pypdf-offline','networkRequests':0})
(root/'pdf-offline-extraction.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(rows))
