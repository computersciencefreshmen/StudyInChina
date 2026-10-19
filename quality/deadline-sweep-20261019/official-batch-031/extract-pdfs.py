"""Offline text extraction of four already saved originals; no network."""
import json,hashlib,datetime
from pathlib import Path
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parent
rows=json.loads((ROOT/'captures.json').read_text('utf8'))
sha=lambda b:hashlib.sha256(b).hexdigest()
out=[]
for row in rows:
 if not row.get('rawPath','').endswith('.pdf'): continue
 raw=(ROOT/row['rawPath']).read_bytes();assert sha(raw)==row['rawSha256']
 reader=PdfReader(ROOT/row['rawPath'])
 text='\n\n'.join('=== PAGE %s ===\n%s'%(i+1,p.extract_text() or '') for i,p in enumerate(reader.pages))
 name=row['name']+'.txt';b=text.encode('utf8');(ROOT/name).write_bytes(b)
 out.append({'name':row['name'],'extractedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'offline-pypdf-bundled-runtime','rawPath':row['rawPath'],'rawSha256':sha(raw),'textPath':name,'textSha256':sha(b),'pageCount':len(reader.pages),'networkRequests':0,'extractSucceeded':True,'characters':len(text)})
(ROOT/'pdf-extractions.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(out,ensure_ascii=False))
