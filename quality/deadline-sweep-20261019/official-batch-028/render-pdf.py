"""Offline PDF visual inspection only."""
import hashlib,json
from pathlib import Path
import pypdfium2 as pdfium
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent
pdf=pdfium.PdfDocument(ROOT/'nxu-2026-original.pdf');sheet=Image.new('RGB',(1200,6*460),'#dddddd');draw=ImageDraw.Draw(sheet)
for n in range(len(pdf)):
    im=pdf[n].render(scale=.6).to_pil();im.thumbnail((295,430));sheet.paste(im,((n%4)*300,(n//4)*460+25));draw.text(((n%4)*300+8,(n//4)*460+5),'PAGE '+str(n+1),fill='black')
sheet.save(ROOT/'nxu-2026-contact.png')
print(json.dumps({'pages':len(pdf),'contact':'nxu-2026-contact.png','sha256':hashlib.sha256((ROOT/'nxu-2026-contact.png').read_bytes()).hexdigest()}))
