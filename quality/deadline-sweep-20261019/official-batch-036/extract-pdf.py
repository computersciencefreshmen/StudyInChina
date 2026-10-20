"""Read already saved WTU PDF offline using the bundled pypdf runtime."""
import json,hashlib,datetime
from pathlib import Path
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parent
row=next(r for r in json.loads((ROOT/'support-captures.json').read_text('utf8')) if r['name']=='wtu-guide-pdf')
sha=lambda b:hashlib.sha256(b).hexdigest()
raw=(ROOT/row['rawPath']).read_bytes();assert sha(raw)==row['rawSha256']
reader=PdfReader(ROOT/row['rawPath']);text='\n\n'.join('=== PAGE %s ===\n%s'%(i+1,p.extract_text() or '') for i,p in enumerate(reader.pages));b=text.encode('utf8')
(ROOT/'wtu-guide-pdf.txt').write_bytes(b)
out={'name':row['name'],'extractedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'offline-pypdf-bundled-runtime','rawPath':row['rawPath'],'rawSha256':sha(raw),'textPath':'wtu-guide-pdf.txt','textSha256':sha(b),'pageCount':len(reader.pages),'networkRequests':0,'extractSucceeded':True,'characters':len(text)}
(ROOT/'pdf-extraction.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(out,ensure_ascii=False))
