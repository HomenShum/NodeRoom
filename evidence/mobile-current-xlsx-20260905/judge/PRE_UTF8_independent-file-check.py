from pathlib import Path
import hashlib,json,zipfile,xml.etree.ElementTree as ET,subprocess
O=Path(__file__).resolve().parent;P=O.parent;W=P/'E6f-noderoom-mobile-export-repair'
R=Path(r'D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905')
def sha(b):return hashlib.sha256(b).hexdigest()
def save(p,x):p.write_text(json.dumps(x,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
S='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}';REL='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
def col(n):
 out=''
 while n:n,k=divmod(n-1,26);out=chr(65+k)+out
 return out
def cells(rows):
 return {f'{col(j)}{i}':v for i,row in enumerate(rows) if row for j,v in enumerate(row) if j and v is not None}
def parse_xlsx(file):
 raw=file.read_bytes();out=[]
 with zipfile.ZipFile(file)as z:
  assert sum(x.file_size for x in z.infolist())<5_000_000
  ss=[]
  if 'xl/sharedStrings.xml'in z.namelist():
   ss=[''.join(t.text or '' for t in si.iter(S+'t')) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(S+'si')]
  rels={x.attrib['Id']:x.attrib['Target'] for x in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
  for s in ET.fromstring(z.read('xl/workbook.xml')).find(S+'sheets'):
   target=rels[s.attrib[REL+'id']];target=target.lstrip('/') if target.startswith('/')else 'xl/'+target
   vals={};formulas={};types={}
   for c in ET.fromstring(z.read(target)).iter(S+'c'):
    a=c.attrib['r'];t=c.attrib.get('t');types[a]=t;v=c.find(S+'v');val=v.text if v is not None else None
    if t=='s':val=ss[int(val)]
    elif t=='inlineStr':val=''.join(x.text or '' for x in c.iter(S+'t'))
    elif val is not None:
     try:val=float(val);val=int(val)if val.is_integer()else val
     except ValueError:pass
    if val is not None:vals[a]=val
    if c.find(S+'f')is not None:formulas[a]=c.find(S+'f').text
   out.append({'name':s.attrib['name'],'cells':vals,'formulas':formulas,'types':types})
 return {'file':str(file.relative_to(O)),'sha256':sha(raw),'bytes':len(raw),'sheets':out}

checks=[]
def check(name,passed,actual=None):checks.append({'name':name,'passed':bool(passed),'actual':actual})
files=[]
for file in sorted((O/'browser-replay').rglob('*.xlsx')):
 actual=parse_xlsx(file);oracle=json.loads(file.with_name(file.stem+'-reopened.json').read_text())
 check(str(file.relative_to(O))+': independent OOXML equals complete expected reopened rows',all(s['cells']==cells(e['rows'])for s,e in zip(actual['sheets'],oracle['sheets'])))
 check(str(file.relative_to(O))+': no formulas in literal mobile workbook',all(not s['formulas']for s in actual['sheets']))
 check(str(file.relative_to(O))+': exact downloaded receipt binding',actual['sha256']==oracle['sha256']and actual['bytes']==oracle['byteCount'])
 files.append(actual)
lit=json.loads((O/'literal-keyboard/report.json').read_text())
for f in lit['files']:
 actual=parse_xlsx(O/'literal-keyboard'/f['file'])
 check(f['file']+': independent OOXML current literal',actual['sheets'][0]['cells']['B2']==f['value'] and actual['sheets'][0]['types']['B2']in ['s','inlineStr']and not actual['sheets'][0]['formulas'])
 check(f['file']+': all independently read values equal actual consumer readback',all(s['cells']==cells(e['rows'])for s,e in zip(actual['sheets'],f['sheets'])))
 files.append(actual)
check('16 actual mobile files inspected independently',len(files)==16,len(files))
desktop=parse_xlsx(O/'desktop-replay/Q3_variance.xlsx');files.append(desktop)
check('Inherited desktop blank Account labels remain explicit',all(desktop['sheets'][0]['cells'].get('A'+str(i),'')==''for i in range(2,7)))
check('Desktop manual note retained',desktop['sheets'][0]['cells'].get('E2')=='Reviewer note: baseline input')
manifest_raw=(W/'artifact-manifest.json').read_bytes();(O/'worker-artifact-manifest-reviewed.json').write_bytes(manifest_raw)
manifest=json.loads(manifest_raw);bad=[]
for f in manifest['files']:
 raw=(W/f['path']).read_bytes()
 if sha(raw)!=f['sha256']or len(raw)!=f['bytes']:bad.append(f['path'])
check('739 worker artifact bytes bound exactly',not bad and len(manifest['files'])==739,{'count':len(manifest['files']),'bytes':manifest['bytes'],'bad':bad})
generated=json.loads((W/'generated-final-manifest.json').read_text());bad=[]
with zipfile.ZipFile(W/generated['archive'])as z:
 for f in generated['files']:
  raw=z.read(f['path'])
  if sha(raw)!=f['sha256']or len(raw)!=f['bytes']:bad.append(f['path'])
check('Retained generated archive exact',sha((W/generated['archive']).read_bytes())==generated['archiveSha256']and not bad,{'files':len(generated['files']),'bad':bad})
dist=[f for f in generated['files']if f['path'].startswith('dist/')];bad=[f['path']for f in dist if sha((R/f['path']).read_bytes())!=f['sha256']]
check('Actual served dist equals retained final build',not bad,{'files':len(dist),'bad':bad})
old=json.loads((P/'E6f-noderoom-first-run/source-before.json').read_text());changes={}
for rel,h in old['files'].items():
 actual=sha((R/rel).read_bytes())
 if actual!=h:changes[rel]=actual
check('1561 protected old inputs unchanged',len(old['files'])==1563 and set(changes)=={'src/ui/mobile/MobileGrid.tsx','src/ui/panels/Artifact.tsx'},changes)
save(O/'independent-file-check.json',{'status':'PASS'if all(c['passed']for c in checks)else'FAIL','method':'Python stdlib ZIP/OOXML parsing independent of ExcelJS; exact source/artifact hashing; no native Office; dirty original environment/workbook files not read. Cell checks compare complete observed consumer matrices and explicit literal values.','checks':checks,'files':files,'workerManifestSha256':sha(manifest_raw)})
print(json.dumps({'status':'PASS'if all(c['passed']for c in checks)else'FAIL','checks':len(checks),'files':len(files),'failures':[c for c in checks if not c['passed']]}))
