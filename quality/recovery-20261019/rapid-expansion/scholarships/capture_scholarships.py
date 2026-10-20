from pathlib import Path
import json,hashlib,urllib.request,urllib.error,urllib.parse,urllib.robotparser,argparse,subprocess
from datetime import datetime,timezone
from html.parser import HTMLParser
class HTMLText(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.parts=[];self.links=[];self.active=None;self.skip=0
 def handle_starttag(self,tag,attrs):
  if tag in ["script","style","noscript"]:self.skip+=1
  if not self.skip and tag in ["p","div","br","li","tr","td","h1","h2","h3"]:self.parts.append("\n")
  if tag=="a":
   href=dict(attrs).get("href")
   if href:self.active={"text":"","hrefLiteral":href};self.links.append(self.active)
 def handle_endtag(self,tag):
  if tag in ["script","style","noscript"] and self.skip:self.skip-=1
  if tag=="a":self.active=None
  if not self.skip and tag in ["p","div","li","tr","h1","h2","h3"]:self.parts.append("\n")
 def handle_data(self,data):
  if not self.skip:self.parts.append(data)
  if self.active is not None:self.active["text"]+=data
BASE=Path(__file__).resolve().parent
AGENT='StudyInChina-Official-Verification/1.0'
SOURCES={
 'central-scholarship-entry':('central','https://www.chinese.cn/page/#/pcpage/project_detail','html'),
 'snnu-apply':('snnu','https://snnu.17gz.org/member/login.do','html'),
 'hunnu-iclt-pdf':('hunnu','https://oiec.hunnu.edu.cn/__local/7/9F/20/3B09B17ED4E487A2E86C16EB7C4_78D71035_61047C.pdf','pdf'),
 'hunnu-apply':('hunnu','https://hunnu.at0086.cn/student','html'),
 'central-homepage':('central','https://www.chinese.cn/','html'),
 'central-scholarship-portal':('central','https://pmplatform.chinese.cn/ui/start/#/login','html'),
 'clec-2026-guide':('central','https://pmplatform.chinese.cn/tmp/2026/2/6/94005b2e-f2e9-438e-85e7-12212f0e9968.pdf','pdf'),
 'shnu-iclt-2026':('shnu','https://iao.shnu.edu.cn/ec/35/c20435a846901/page.htm','html'),
 'sisu-iclt-2026':('sisu','https://www.oisa.shisu.edu.cn/index.php/index/newscontent/cid/39/id/666.html','html'),
 'blcu-iclt-2026':('blcu','https://admission.blcu.edu.cn/en/2026/0303/c1148a3044/page.htm','html'),
 'snnu-iclt-2026':('snnu','https://study.snnu.edu.cn/info/1066/1238.htm','html'),
 'hznu-iclt-2026':('hznu','https://gjjyxy.hznu.edu.cn/c/2026-03-01/2996148.shtml','html'),
 'hunnu-iclt-2026':('hunnu','https://oiec.hunnu.edu.cn/info/1061/4240.htm','html'),
}
def now():return datetime.now(timezone.utc).isoformat()
def sha(b):return hashlib.sha256(b).hexdigest()
def save(p,d):
 with p.open('x',encoding='utf-8',newline='\n') as f:json.dump(d,f,ensure_ascii=False,indent=2);f.write('\n')
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a):return None
OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({'https':'http://127.0.0.1:7897','http':'http://127.0.0.1:7897'}),NoRedirect())
def get(url,host,maximum):
 current=url;redirects=[]
 for _ in range(6):
  p=urllib.parse.urlsplit(current)
  if p.scheme!='https' or p.hostname!=host or p.username or p.password:raise ValueError('exact_official_https_host_boundary')
  req=urllib.request.Request(current,headers={'User-Agent':AGENT,'Accept':'*/*'})
  try:r=OPENER.open(req,timeout=35)
  except urllib.error.HTTPError as e:r=e
  status=r.status
  if status in [301,302,303,307,308]:
   target=urllib.parse.urljoin(current,r.headers.get('Location',''));redirects.append({'from':current,'status':status,'to':target});r.close();current=target;continue
  raw=r.read(maximum+1);h={k:v for k,v in r.headers.items() if k.lower() in ['content-type','content-length','date','etag','last-modified']};r.close()
  if len(raw)>maximum:raise ValueError('bounded_size_exceeded')
  return {'requestedUrl':url,'url':current,'httpStatus':status,'retrievedAt':now(),'redirects':redirects,'headers':h},raw
 raise ValueError('redirect_limit')
def main(name):
 school,url,kind=SOURCES[name];directory=BASE/school;directory.mkdir(exist_ok=True)
 stem=directory/name
 if list(directory.glob(name+'.*')):raise ValueError('immutable_capture_identity_already_exists')
 attempt={'source':url,'startedAt':now(),'userAgent':AGENT,'transport':'normal-HTTPS-existing-local-proxy','outcome':'held'}
 try:
  host=urllib.parse.urlsplit(url).hostname;robots,rb=get('https://'+host+'/robots.txt',host,1024*1024);rp=stem.with_suffix('.robots.txt');rp.write_bytes(rb)
  allowed=robots['httpStatus'] in [404,410]
  if 200<=robots['httpStatus']<300:
   rules=urllib.robotparser.RobotFileParser();rules.parse(rb.decode('utf-8',errors='replace').splitlines());allowed=rules.can_fetch(AGENT,url)
  robots.update({'rawPath':str(rp.relative_to(Path.cwd())).replace('\\','/'),'sha256':sha(rb),'allowed':allowed});attempt['robots']=robots
  if not allowed:raise ValueError('robots_disallowed_or_unavailable')
  receipt,raw=get(url,host,(32 if kind=='pdf' else 8)*1024*1024);attempt['response']=receipt
  if receipt['httpStatus']!=200:raise ValueError('source_http_'+str(receipt['httpStatus']))
  if kind=='pdf' and not raw.startswith(b'%PDF-'):raise ValueError('pdf_magic_missing')
  rawpath=stem.with_suffix('.'+kind)
  with rawpath.open('xb') as f:f.write(raw)
  links=[];textpath=stem.with_suffix('.text.txt')
  if kind=='pdf':
   r=subprocess.run(['pdftotext','-layout','-enc','UTF-8',str(rawpath),str(textpath)],capture_output=True,timeout=60)
   if r.returncode:raise ValueError('pdf_text_extraction_failed')
  else:
   parser=HTMLText();parser.feed(raw.decode('utf-8',errors='replace'));links=[{**a,'text':a['text'].strip(),'resolvedUrl':urllib.parse.urljoin(receipt['url'],a['hrefLiteral'])} for a in parser.links]
   with textpath.open('x',encoding='utf-8',newline='\n') as f:f.write('\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())+'\n')
  receipt.update({'sourceName':name,'rawPath':str(rawpath.relative_to(Path.cwd())).replace('\\','/'),'rawBytes':len(raw),'rawSha256':sha(raw),'textPath':str(textpath.relative_to(Path.cwd())).replace('\\','/'),'textSha256':sha(textpath.read_bytes()),'robots':robots,'links':links,'captureMethod':'normal verified HTTPS; exact host; bounded bytes; no auth/identity/WAF changes'})
  save(stem.with_suffix('.receipt.json'),receipt);attempt['outcome']='captured';print(json.dumps({'source':name,'outcome':'captured','retrievedAt':receipt['retrievedAt'],'rawBytes':len(raw),'rawSha256':sha(raw)}))
 except Exception as e:attempt['failure']=type(e).__name__+': '+str(e).split('\n')[0];print(json.dumps({'source':name,'outcome':'held','failure':attempt['failure']}))
 finally:attempt['endedAt']=now();save(stem.with_suffix('.attempt.json'),attempt)
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('source',choices=SOURCES);main(parser.parse_args().source)
