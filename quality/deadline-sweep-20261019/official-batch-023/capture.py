"""Single bounded read per selected public official source; no approval mutation."""
import concurrent.futures
import hashlib
import html
import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
SOURCES = [
 ('hebtu','https://cice.hebtu.edu.cn/a/2025/11/27/6EFE88E38B8F41739568513CC10C148A.html'),
 ('hebut','https://eweb.hebut.edu.cn/admission/InternationalStudents/prospectus/4f0f206db54b4d67984fdd9b9b483394.htm'),
 ('hfut','https://iec.hfut.edu.cn/2025/1128/c11677a316558/page.htm'),
 ('henu','https://isclc.henu.edu.cn/info/1021/1500.htm'),
 ('haut','https://sie.haut.edu.cn/info/1298/17096.htm'),
 ('hhu','https://cie.hhu.edu.cn/2025/1030/c14608a309299/pagem.htm'),
 ('hqu','https://zsc.hqu.edu.cn/info/1081/8892.htm'),
 ('henu-programmes','https://isclc.henu.edu.cn/dfiles/fujian/202211/5.henandaxueyingwenshoukezhuanyemulu%20English%20Taught%20Programs%20of%20Henan%20University.pdf')
]

def capture(row):
    key,url=row
    r={'key':key,'url':url,'observedAt':datetime.now(timezone.utc).isoformat(),'method':'GET'}
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'StudyInChina-Date-Recheck/1.0','Accept':'text/html,application/pdf,image/*'})
        with urllib.request.urlopen(req,timeout=22) as response:
            r.update(httpStatus=response.status,finalUrl=response.url,contentType=response.headers.get('Content-Type'))
            assert urlparse(url).hostname==urlparse(response.url).hostname,'unexpected_cross_host_redirect'
            raw=response.read(15*1024*1024+1)
            assert len(raw)<=15*1024*1024,'response_size_limit'
            suffix='.pdf' if raw.startswith(b'%PDF-') else '.png' if raw.startswith(b'\x89PNG') else '.jpg' if raw.startswith(b'\xff\xd8') else '.xls' if raw.startswith(b'\xd0\xcf\x11\xe0') else '.xlsx' if raw.startswith(b'PK\x03\x04') else '.html'
            body=ROOT/(key+suffix)
            body.open('xb').write(raw)
            r.update(bodyPath=body.name,bytes=len(raw),bodySha256=hashlib.sha256(raw).hexdigest())
            if suffix=='.html':
                decoded=raw.decode(response.headers.get_content_charset() or 'utf8',errors='replace')
                decoded=re.sub(r'<(script|style)\b[^>]*>[\s\S]*?</\1>','',decoded,flags=re.I)
                text=html.unescape(re.sub('<[^>]+>','\n',decoded))
                text='\n'.join(x.strip()for x in text.splitlines()if x.strip())+'\n'
                (ROOT/(key+'.txt')).open('x',encoding='utf8').write(text)
                r['textPath']=key+'.txt'
    except urllib.error.HTTPError as e:
        r.update(httpStatus=e.code,error='HTTPError:'+str(e.code),officialDateVerified=False)
    except Exception as e:
        r.update(error=type(e).__name__+':'+str(e),officialDateVerified=False)
    return r

if __name__=='__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        rows=list(pool.map(capture,SOURCES))
    report={'schemaVersion':1,'maxConcurrency':2,'automaticRetries':0,'paidCalls':0,'canonicalWrites':0,'rows':rows}
    (ROOT/'captures.json').open('x',encoding='utf8').write(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(rows,ensure_ascii=False))
