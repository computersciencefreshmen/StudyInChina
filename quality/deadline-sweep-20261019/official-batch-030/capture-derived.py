"""One exact linked-original retrieval each for the image-only/partial parent pages."""
import concurrent.futures, datetime, hashlib, json, runpy, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent
core=runpy.run_path(str(ROOT.parent/'official-batch-018'/'capture-current.py'),run_name='capture_helpers')
capture=core['capture'];capture.__globals__['ROOT']=ROOT
def image_capture(item):
 name,url=item; r={'name':name,'url':url,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'timeoutSeconds':25,'tlsCertificateValidation':True,'parentCapture':'sdu-csc','parentRawSha256':hashlib.sha256((ROOT/'sdu-csc.html').read_bytes()).hexdigest(),'linkage':'Exact image src in registered 2026 Type B guide body; one bounded retrieval.'}
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (compatible; public-admissions-date-check/1.0)'})
  with urllib.request.urlopen(req,timeout=25) as resp:
   raw=resp.read(12000001);assert len(raw)<=12000000;assert raw.startswith(b'\xff\xd8')
   target=ROOT/(name+'.jpg');target.write_bytes(raw)
   from PIL import Image
   with Image.open(target) as im:dimensions=list(im.size)
   r.update(status=resp.status,finalUrl=resp.url,contentType=resp.headers.get('Content-Type'),bytes=len(raw),rawPath=target.name,rawSha256=hashlib.sha256(raw).hexdigest(),dimensions=dimensions,captureSucceeded=True)
 except Exception as e:r.update(captureSucceeded=False,error=str(e),retryPolicy='cooldown-no-further-retries')
 return r
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as p:
 a=p.submit(capture,('sdjzu-2026-original','https://www.sdjzu.edu.cn/system/_content/download.jsp?urltype=news.DownloadAttachUrl&owner=2120571760&wbfileid=15404568'))
 b=p.submit(image_capture,('sdu-csc-original','https://istudy.sdu.edu.cn/__local/6/C6/73/8AC3F1556827637C3DF94D94CCB_9B4C7643_2681CB.jpg'))
 rows=[a.result(),b.result()]
rows[0].update(parentCapture='sdjzu-admissions',parentRawSha256=hashlib.sha256((ROOT/'sdjzu-admissions.html').read_bytes()).hexdigest(),linkage='Exact 2026 Admission Prospectus PDF href in the registered current guide; one bounded retrieval.')
(ROOT/'derived-captures.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(rows,ensure_ascii=False))
