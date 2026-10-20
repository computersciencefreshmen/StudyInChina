import concurrent.futures,hashlib,html,json,re,urllib.request,urllib.error
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parent
S=json.loads((ROOT/'selection.json').read_text('utf8'))
SELECT={'source-01','source-02','source-03','source-04','source-05','source-09','source-11','source-12','source-13'}
def capture(row):
 key,url=row['key'],row['url'];r={'key':key,'url':url,'method':'GET','startedAt':datetime.now(timezone.utc).isoformat(),'automaticRetries':0}
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'StudyInChina-Date-Recheck/1.0','Accept':'text/html,application/pdf'})
  try:response=urllib.request.urlopen(req,timeout=22)
  except urllib.error.HTTPError as e:response=e;r['error']='HTTPError:'+str(e.code)
  with response:
   r.update(httpStatus=response.status,finalUrl=response.url,contentType=response.headers.get('Content-Type'))
   raw=response.read(15*1024*1024+1)
   if len(raw)>15*1024*1024:raise ValueError('Response exceeds 15MiB capture cap')
   suffix='.pdf' if raw.startswith(b'%PDF-') else '.html'
   file=ROOT/(key+suffix);file.open('xb').write(raw)
   r.update(rawPath=file.name,rawSha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw))
   text=None
   if suffix=='.pdf':
    from pypdf import PdfReader
    pdf=PdfReader(file);r['pages']=len(pdf.pages);text='\n'.join('\n---PAGE '+str(i+1)+'---\n'+(p.extract_text() or '')for i,p in enumerate(pdf.pages))
   else:
    charset=response.headers.get_content_charset()or'utf8';r['charset']=charset
    text=raw.decode(charset,errors='replace');text=re.sub(r'<(script|style)\b[^>]*>[\s\S]*?</\1>','',text,flags=re.I)
    text=html.unescape(re.sub('<[^>]+>','\n',text));text='\n'.join(x.strip()for x in text.splitlines()if x.strip())+'\n'
   if text is not None:
    f=ROOT/(key+'.txt');f.open('x',encoding='utf8').write(text);r.update(textPath=f.name,textSha256=hashlib.sha256(f.read_bytes()).hexdigest())
 except Exception as e:r['error']=type(e).__name__+':'+str(e)
 r['observedAt']=datetime.now(timezone.utc).isoformat()
 (ROOT/(key+'.receipt.json')).open('x',encoding='utf8').write(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
 return r
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:rows=list(pool.map(capture,[x for x in S['pages']if x['key']in SELECT]))
 (ROOT/'captures.json').open('x',encoding='utf8').write(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(rows,ensure_ascii=False))
