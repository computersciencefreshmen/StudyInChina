"""One exact attachment per relevant captured guide; no directory search."""
import concurrent.futures, datetime, hashlib, html.parser, io, json, urllib.parse, urllib.request, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
ROOT=Path(__file__).resolve().parent
class Links(html.parser.HTMLParser):
    def __init__(self): super().__init__(); self.href=None; self.links=[]
    def handle_starttag(self,tag,attrs):
        if tag=='a': self.href=dict(attrs).get('href')
    def handle_data(self,data):
        if self.href: self.links.append((self.href,data))
    def handle_endtag(self,tag):
        if tag=='a': self.href=None
def sha(b): return hashlib.sha256(b).hexdigest()
def work(item):
    name,parent,needle,ext=item
    c=next(x for x in json.loads((ROOT/'captures.json').read_text()) if x['name']==parent)
    parser=Links(); parser.feed((ROOT/c['rawPath']).read_text(encoding='utf-8'))
    matches=[href for href,label in parser.links if needle in label]; assert len(matches)==1,matches
    url=urllib.parse.urljoin(c['url'],matches[0])
    out={'name':name,'url':url,'parentSource':parent,'parentBodySha256':c['rawSha256'],'linkLabel':needle,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'timeoutSeconds':25,'maximumBytes':12000000,'tlsCertificateValidation':True,'route':'one-exact-linked-original-not-directory-search'}
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (compatible; public-admissions-date-check/1.0)'})
        with urllib.request.urlopen(req,timeout=25) as resp:
            b=resp.read(12000001); assert len(b)<=12000000
            out.update(status=resp.status,finalUrl=resp.url,contentType=resp.headers.get('Content-Type'),bytes=len(b))
        actual=ext if (ext=='pdf' and b.startswith(b'%PDF')) or (ext=='xlsx' and b.startswith(b'PK')) else 'html'
        raw=ROOT/(name+'.'+actual);raw.write_bytes(b);out.update(rawPath=raw.name,rawSha256=sha(b))
        if actual=='pdf':
            from pypdf import PdfReader
            reader=PdfReader(raw);text='\n\n'.join('=== PAGE %d ===\n%s'%(n+1,p.extract_text() or '') for n,p in enumerate(reader.pages));out['pageCount']=len(reader.pages)
        elif actual=='xlsx':
            ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            with zipfile.ZipFile(io.BytesIO(b)) as z:
                shared=[]
                if 'xl/sharedStrings.xml' in z.namelist():
                    shared=[''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns)]
                lines=[]
                for part in z.namelist():
                    if part.startswith('xl/worksheets/sheet') and part.endswith('.xml'):
                        lines.append('=== '+part+' ===')
                        for row in ET.fromstring(z.read(part)).findall('.//m:row',ns):
                            values=[]
                            for cell in row.findall('m:c',ns):
                                value=cell.find('m:v',ns);v=value.text if value is not None else ''.join(cell.itertext());v=shared[int(v)] if cell.get('t')=='s' else v
                                if v: values.append(cell.get('r')+'='+v)
                            if values:lines.append(' | '.join(values))
                text='\n'.join(lines)
        else: text=b.decode('utf-8',errors='replace')
        textPath=ROOT/(name+'.txt');encoded=text.encode('utf-8');textPath.write_bytes(encoded)
        out.update(textPath=textPath.name,textSha256=sha(encoded),captureSucceeded=True,originalAttachmentTypeMatched=actual==ext)
    except Exception as e: out.update(captureSucceeded=False,error=str(e),retryPolicy='cooldown-no-further-retries')
    return out
items=[('lnu-2026-graduate-catalogue','source-02','Appendix 2 2026 Liaoning University Graduate Programs for International Students.xlsx','xlsx'),('nxu-2026-original','source-09','2026版招生简章电子版.pdf','pdf')]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: rows=list(pool.map(work,items))
(ROOT/'linked-captures.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(rows,ensure_ascii=False))
