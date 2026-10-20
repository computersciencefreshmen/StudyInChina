import json
from pathlib import Path
from pypdf import PdfReader

directory=Path(__file__).resolve().parent
results=[]
for name in ['tjnu-official-attachment','ynu-existing-school-guide']:
    receipt=json.loads((directory/(name+'.receipt.json')).read_text(encoding='utf-8'))
    if receipt.get('status')!=200:
        continue
    reader=PdfReader(directory/receipt['bodyPath'])
    pages=[page.extract_text() or '' for page in reader.pages]
    with (directory/(name+'.txt')).open('x',encoding='utf-8') as handle:
        handle.write('\n\n'.join('PAGE '+str(index+1)+'\n'+text for index,text in enumerate(pages)))
    results.append({'name':name,'pages':len(pages),'characters':sum(len(text) for text in pages)})
print(json.dumps(results))
