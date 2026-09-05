from pathlib import Path
import hashlib,json,subprocess,shutil,zipfile,datetime
O=Path(__file__).resolve().parent
P=O.parent
C=Path('D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905')
R=Path('D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/noderoom')
B=P/'E6f-noderoom-first-run'
def sha(b): return hashlib.sha256(b).hexdigest()
def dump(path,value): path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
def git(root,*args):
 p=subprocess.run(['git','-C',str(root),*args],capture_output=True,timeout=30)
 assert p.returncode==0,(args,p.returncode,p.stderr.decode('utf-8',errors='replace'))
 return p.stdout
scope=json.loads((O/'custody.json').read_text(encoding='utf-8'))['scope']
source={p:sha((C/p).read_bytes()) for p in sorted(scope)}
assert all(b'\r' not in (C/p).read_bytes() for p in scope),'non-LF authored source'
status=git(C,'status','--porcelain=v1','-z')
actual={item[3:].decode('utf-8') for item in status.split(b'\0') if item}
assert actual==set(scope),(actual,scope)
assert git(C,'diff','--cached','--name-only')==b''
commands={}
for label,args in {'head':['rev-parse','HEAD'],'index':['ls-files','--stage','-z'],'refs':['for-each-ref','--format=%(refname) %(objectname)'],'status':['status','--porcelain=v1','-z'],'diff':['diff','--binary'],'diff-check':['diff','--check']}.items():
 data=git(C,*args);(O/f'candidate-{label}-final.bin').write_bytes(data);commands[label]={'argv':['git',*args],'exit':0,'sha256':sha(data)}
for label in ['head','index','refs']:
 assert (O/f'{label}-before.bin').read_bytes()==(O/f'candidate-{label}-final.bin').read_bytes(),f'candidate {label} changed'
primary={}
for label,args in {'head':['rev-parse','HEAD'],'index':['ls-files','--stage','-z'],'refs':['for-each-ref','--format=%(refname) %(objectname)'],'status':['status','--porcelain=v1','-z'],'worktrees':['worktree','list','--porcelain']}.items():
 data=git(R,*args);(O/f'primary-{label}-final.bin').write_bytes(data)
 old=(B/f'primary-{label}-final.bin').read_bytes();primary[label]={'sha256':sha(data),'matchesFirstRunFinal':data==old};assert data==old,f'primary {label} changed'
baseline=json.loads((B/'source-before.json').read_text(encoding='utf-8'))
guard={p:sha((C/p).read_bytes()) for p in baseline['files']}
changed={p:{'before':baseline['files'][p],'after':guard[p]} for p in guard if baseline['files'][p]!=guard[p]}
assert set(changed)=={'src/ui/mobile/MobileGrid.tsx','src/ui/panels/Artifact.tsx'},changed
dump(O/'protected-source-final.json',{'count':len(guard),'files':guard,'changed':changed,'unchanged':len(guard)-len(changed)})
proofs=list((O/'browser-proof-final/artifacts').glob('*/source-bindings.json'))
assert len(proofs)==8
proof_bindings=[]
for proof in proofs:
 bound=json.loads(proof.read_text(encoding='utf-8'))
 assert all(sha((C/p).read_bytes())==digest for p,digest in bound.items())
 proof_bindings.append({'path':proof.relative_to(O).as_posix(),'sha256':sha(proof.read_bytes()),'matched':len(bound)})
capture_paths=set(scope)|set(json.loads(proofs[0].read_text(encoding='utf-8')))
target=O/'source-final';target.mkdir()
for p in sorted(capture_paths):
 f=target/p;f.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(C/p,f)
dump(O/'source-final.json',{'scope':source,'capturedFiles':{p:sha((target/p).read_bytes()) for p in sorted(capture_paths)},'sourceDigestFormula':'SHA256(UTF8(JSON.stringify(sorted [path, sha256] entries), no spaces/newline; forward-slash relative paths))','sourceDigest':sha(json.dumps(sorted(source.items()),ensure_ascii=False,separators=(',',':')).encode('utf-8'))})
# Preserve generated output only; do not alter the candidate's ignored build/test state.
generated=[]
archive=O/'generated-final.zip'
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
 for folder in ['dist','test-results']:
  for f in sorted((C/folder).rglob('*')):
   if not f.is_file(): continue
   assert not f.is_symlink() and not (getattr(f.stat(),'st_file_attributes',0)&1024),f
   data=f.read_bytes();rel=f.relative_to(C).as_posix();z.writestr(rel,data);assert f.read_bytes()==data
   generated.append({'path':rel,'sha256':sha(data),'bytes':len(data)})
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 for item in generated: assert sha(z.read(item['path']))==item['sha256']
dump(O/'generated-final-manifest.json',{'archive':'generated-final.zip','archiveSha256':sha(archive.read_bytes()),'files':generated,'count':len(generated),'allZipPayloadsRehashed':True})
source_receipt=json.loads((O/'source-final.json').read_text(encoding='utf-8'))
dump(O/'freeze.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'candidate':str(C),'baseCommit':git(C,'rev-parse','HEAD').decode().strip(),'branch':git(C,'branch','--show-current').decode().strip(),'source':source_receipt,'commands':commands,'primary':primary,'protectedTrackedSource':{'count':len(guard),'unchanged':len(guard)-2,'changed':changed},'browserSourceBindings':proof_bindings,'state':'Exactly seven unstaged paths; unchanged HEAD/index/refs; no commit or push','generatedCustody':{'count':len(generated),'sha256':sha(archive.read_bytes())},'baselineManifestUnchanged':sha((B/'artifact-manifest.json').read_bytes())=='a5c3b363ab853e479b27010290beb4b6a62c9469a28bfd2e3c75fa1f839829c6'})
print(json.dumps({'sourceDigest':source_receipt['sourceDigest'],'scope':source,'protectedUnchanged':len(guard)-2,'generatedCaptured':len(generated)}))
