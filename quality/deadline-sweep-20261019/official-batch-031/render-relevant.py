"""Render only local original PDF pages used for date identity checks."""
from pathlib import Path
import subprocess,json,hashlib,datetime
from PIL import Image,ImageOps,ImageDraw
ROOT=Path(__file__).resolve().parent
pages={'nwnu-guide':[1],'shcm-guide':[1,2,5,8],'sta-guide':[1,2],'suep-guide':[1,3,4,7,8,11,12]}
manifest=[]
for name,nums in pages.items():
 images=[]
 for page in nums:
  out=ROOT/(name+'-page-'+str(page))
  subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-singlefile','-scale-to','1400','-png',str(ROOT/(name+'.pdf')),str(out)],check=True,capture_output=True)
  image=Image.open(str(out)+'.png').convert('RGB');thumb=image.copy();thumb.thumbnail((700,1000))
  canvas=Image.new('RGB',(720,1040),'#dddddd');canvas.paste(thumb,((720-thumb.width)//2,30));ImageDraw.Draw(canvas).text((10,8),name+' page '+str(page),fill='black');images.append(canvas)
  b=Path(str(out)+'.png').read_bytes();manifest.append({'original':name+'.pdf','page':page,'path':out.name+'.png','sha256':hashlib.sha256(b).hexdigest(),'renderedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'pdftoppm-complete-page-1400px'})
 sheet=Image.new('RGB',(720*min(3,len(images)),1040*((len(images)+2)//3)),'#aaaaaa')
 for i,img in enumerate(images):sheet.paste(img,((i%3)*720,(i//3)*1040))
 sheet.save(ROOT/(name+'-contact.png'))
(ROOT/'pdf-render-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
print(json.dumps({'pages':len(manifest),'contactSheets':list(pages)}))
