"""Offline recovery of already saved official PDF; no network."""
import datetime,hashlib,json
from pathlib import Path
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parent
b=(ROOT/'nxu-2026-original.pdf').read_bytes();reader=PdfReader(ROOT/'nxu-2026-original.pdf')
text='\n\n'.join('=== PAGE %d ===\n%s'%(n+1,p.extract_text() or '') for n,p in enumerate(reader.pages));encoded=text.encode('utf-8');(ROOT/'nxu-2026-original.txt').write_bytes(encoded)
receipt={'name':'nxu-2026-original-offline-text','operation':'offline-existing-original-extraction-no-network','extractedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rawPath':'nxu-2026-original.pdf','rawSha256':hashlib.sha256(b).hexdigest(),'textPath':'nxu-2026-original.txt','textSha256':hashlib.sha256(encoded).hexdigest(),'pageCount':len(reader.pages),'textExtractionSucceeded':True}
(ROOT/'pdf-extraction.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(receipt))
