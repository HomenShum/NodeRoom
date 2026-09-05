from pathlib import Path
import json,hashlib,datetime,difflib,subprocess
A=Path(__file__).resolve().parent;P=A.parent;O=P/'E6f-noderoom-mobile-export-repair'
C=Path('D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905')
def sha(b):return hashlib.sha256(b).hexdigest()
def dump(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
old=json.loads((A/'previous-source-final.json').read_text(encoding='utf-8'))
old_doc=(A/'HANDOFF.before.md.txt').read_bytes();new_doc=(C/'HANDOFF.md').read_bytes()
assert sha(old_doc)==old['scope']['HANDOFF.md'] and b'\r' not in new_doc
current={p:sha((C/p).read_bytes()) for p in old['scope']}
assert [p for p in current if current[p]!=old['scope'][p]]==['HANDOFF.md']
digest=sha(json.dumps(sorted(current.items()),ensure_ascii=False,separators=(',',':')).encode('utf-8'))
(A/'HANDOFF.after.md.txt').write_bytes(new_doc)
(A/'HANDOFF.diff').write_text(''.join(difflib.unified_diff(old_doc.decode('utf-8').splitlines(True),new_doc.decode('utf-8').splitlines(True),fromfile='HANDOFF.md before',tofile='HANDOFF.md after')),encoding='utf-8',newline='\n')
for label,args in {'head':['rev-parse','HEAD'],'index':['ls-files','--stage','-z'],'refs':['for-each-ref','--format=%(refname) %(objectname)'],'status':['status','--porcelain=v1','-z'],'diff':['diff','--binary']}.items():
 r=subprocess.run(['git','-C',str(C),*args],capture_output=True,timeout=30);assert r.returncode==0;assert r.stdout==(O/f'candidate-{label}-final.bin').read_bytes();(A/f'candidate-{label}.bin').write_bytes(r.stdout)
assert sha((O/'artifact-manifest.json').read_bytes())=='bfaaf096afb8e9dcd8d2a13931c0092f017a0e5ec1f5a7c9dc35be613132eea0'
assert sha((P/'E6f_NODEROOM_MOBILE_EXPORT_REPAIR_RECEIPT.json').read_bytes())=='1dc9a6b4285d90ba50d35903656a63504552e967d13c967d323c6389ff6f1d58'
receipt={'status':'DOCUMENTATION_ONLY_REFREEZE_PENDING_JUDGE','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'reason':'Independent fresh-checkout review found missing browser installation prerequisite. Parent explicitly authorized the one-file correction.','previousSourceDigest':old['sourceDigest'],'sourceDigest':digest,'sourceDigestFormula':old['sourceDigestFormula'],'source':current,'changedOnly':['HANDOFF.md'],'beforeHandoffSha256':sha(old_doc),'afterHandoffSha256':sha(new_doc),'original739ArtifactManifestUnchanged':True,'originalReceiptUnchanged':True,'candidateHeadIndexRefsStatusAndTrackedDiffUnchanged':True,'runtimeRerun':'Not required: no runtime, test, package, lock, build or browser output changed. Original14-source proof has one documented HANDOFF-only metadata delta.','prerequisite':'npx playwright install chromium; Linux --with-deps only when system packages are required and permitted','previousReceipt':'E6f_NODEROOM_MOBILE_EXPORT_REPAIR_RECEIPT.json','next':'Judge checks this doc delta and binds the effective seven-file source digest. No commit/push.'}
dump(P/'E6f_NODEROOM_MOBILE_EXPORT_HANDOFF_ADDENDUM.json',receipt)
dump(A/'source-final.json',{'scope':current,'sourceDigest':digest,'previousSourceDigest':old['sourceDigest']})
print(json.dumps({'sourceDigest':digest,'handoffSha256':sha(new_doc),'receiptSha256':sha((P/'E6f_NODEROOM_MOBILE_EXPORT_HANDOFF_ADDENDUM.json').read_bytes())}))
