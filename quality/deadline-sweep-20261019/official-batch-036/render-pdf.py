"""Offline complete-page rendering of the saved image-only official WTU PDF."""
from pathlib import Path
import subprocess,json,hashlib,datetime
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent
images=[];manifest=[]
for page in range(1,7):
 out=ROOT/('wtu-guide-page-'+str(page))
 subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-singlefile','-scale-to','1600','-png',str(ROOT/'wtu-guide-pdf.pdf'),str(out)],check=True,capture_output=True)
 im=Image.open(str(out)+'.png').convert('RGB');thumb=im.copy();thumb.thumbnail((700,1000))
 canvas=Image.new('RGB',(720,1040),'#dddddd');canvas.paste(thumb,((720-thumb.width)//2,30));ImageDraw.Draw(canvas).text((10,8),'WTU original 2026 guide page '+str(page),fill='black');images.append(canvas)
 b=Path(str(out)+'.png').read_bytes();manifest.append({'original':'wtu-guide-pdf.pdf','page':page,'path':out.name+'.png','sha256':hashlib.sha256(b).hexdigest(),'renderedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'pdftoppm-complete-page-1600px'})
sheet=Image.new('RGB',(2160,2080),'#aaaaaa')
for i,im in enumerate(images):sheet.paste(im,((i%3)*720,(i//3)*1040))
sheet.save(ROOT/'wtu-guide-contact.png')
(ROOT/'pdf-render-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
print(json.dumps({'pages':len(manifest),'contactSheet':'wtu-guide-contact.png'}))
