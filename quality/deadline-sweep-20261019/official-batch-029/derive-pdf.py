import datetime,hashlib,json
from pathlib import Path
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parent
raw=ROOT/'source-03.pdf'
reader=PdfReader(raw)
text='\n\n'.join('=== PAGE %s ===\n%s'%(i+1,p.extract_text() or '') for i,p in enumerate(reader.pages))
body=text.encode('utf-8');(ROOT/'source-03.txt').write_bytes(body)
receipt={'name':'source-03-local-extraction','method':'local-bundled-pypdf-no-second-HTTP-request','derivedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rawPath':raw.name,'rawSha256':hashlib.sha256(raw.read_bytes()).hexdigest(),'bytes':raw.stat().st_size,'textPath':'source-03.txt','textSha256':hashlib.sha256(body).hexdigest(),'pageCount':len(reader.pages),'originalBodyObtained':True,'bodyType':'not-yet-classified-local-PDF'}
(ROOT/'pdf-extraction.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(text[:6000])
