from pathlib import Path
import json,hashlib,shutil,datetime
O=Path(__file__).resolve().parent;P=O.parent
def sha(b):return hashlib.sha256(b).hexdigest()
def dump(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
plan=json.loads((P/'E6f_NODEROOM_MOBILE_EXPORT_PLAN.json').read_text(encoding='utf-8'))
before=[]
for item in plan['beforeArtifacts']:
 src=P/item['path'];data=src.read_bytes();assert sha(data)==item['sha256']
 target=O/'approved-before'/item['path']
 if target.suffix=='.md':target=target.with_suffix('.md.txt')
 target.parent.mkdir(parents=True,exist_ok=True);assert not target.exists();target.write_bytes(data)
 before.append({'original':item['path'],'copy':target.relative_to(O).as_posix(),'sha256':item['sha256']})
for name in ['E6f_NODEROOM_MOBILE_EXPORT_PLAN.json','E6f_NODEROOM_MOBILE_EXPORT_PLAN.md','E6f_NODEROOM_FIRST_RUN_RECEIPT.json','E6f_NODEROOM_FIRST_RUN_BASELINE_JUDGE.json','E6f_NODEROOM_WINDOWS_REPAIR_DIAGNOSIS.json']:
 src=P/name;target=O/'approved-before'/(name+'.txt' if name.endswith('.md') else name);target.write_bytes(src.read_bytes())
dump(O/'approved-before-copy-bindings.json',before)
pngs=[];downloads=[]
for file in sorted((O/'browser-proof-final/artifacts').rglob('*.json')):
 data=json.loads(file.read_text(encoding='utf-8'))
 if isinstance(data,dict) and 'pngSha256' in data:
  png=file.with_suffix('.png');html=file.with_suffix('.html')
  assert sha(png.read_bytes())==data['pngSha256'];assert sha(html.read_bytes())==data['htmlSha256']
  pngs.append({'path':png.relative_to(O).as_posix(),'sha256':data['pngSha256'],'viewport':data['viewport'],'url':data['url'],'documentOverflow':data['overflow']})
 if file.name.endswith('-reopened.json'):
  xlsx=file.with_name(file.name.removesuffix('-reopened.json')+'.xlsx');assert sha(xlsx.read_bytes())==data['sha256']
  assert len(data['sheets'])==2;downloads.append({'path':xlsx.relative_to(O).as_posix(),'sha256':data['sha256'],'byteCount':data['byteCount']})
assert len(pngs)==40 and len(downloads)==19,(len(pngs),len(downloads))
runtime=[json.loads(p.read_text(encoding='utf-8')) for p in (O/'browser-proof-final/artifacts').glob('*/runtime-observations.json')]
assert len(runtime)==8 and all(not r['errors'] for r in runtime)
dump(O/'final-browser-artifact-recount.json',{'screenshots':pngs,'downloads':downloads,'screenshotCount':len(pngs),'downloadCount':len(downloads),'pageErrors':0,'externalRequests':'Blocked; fallback Google fonts; no model or shared backend call','grades':{'visual':None,'responsive':None,'accessibility':None,'performance':None,'production':None}})
dump(O/'custody-format-attempt-note.json',{'status':'HARNESS_FORMAT_MISMATCH_CORRECTED','rawFailure':'AssertionError: candidate refs changed','cause':'Initial script compared git show-ref (hash then ref) against preserved for-each-ref (ref then hash). The corrected command matches exact original bytes; no refs changed.','preserved':['freeze-candidate-format-attempt-01.py.txt','refs-show-ref-format-attempt-01.bin'],'final':'freeze.json'})
freeze=json.loads((O/'freeze.json').read_text(encoding='utf-8'))
command_names=['targeted-tests-final','convex-typecheck-final','memory-regression-final','browser-proof-final','desktop-final-export']
commands=[json.loads((O/f'{n}.command.json').read_text(encoding='utf-8')) for n in command_names]
assert all(c['exitCode']==0 and not c['timedOut'] for c in commands)
manifest=[]
for file in sorted(O.rglob('*')):
 if not file.is_file() or file.name=='artifact-manifest.json':continue
 assert not file.is_symlink() and not(getattr(file.stat(),'st_file_attributes',0)&1024)
 data=file.read_bytes();manifest.append({'path':file.relative_to(O).as_posix(),'sha256':sha(data),'bytes':len(data)})
dump(O/'artifact-manifest.json',{'schema':'portfolio-scoped-artifact-manifest/v1','count':len(manifest),'bytes':sum(i['bytes'] for i in manifest),'files':manifest,'exclusions':['This manifest itself','External final receipt and future independent judge (avoid circular hashes)','Original first-run packet stays separately frozen; selected before artifacts are copied and rebound']})
receipt={'schema':'noderoom-mobile-export-repair/v1','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'WORKER_PROOF_PASS_PENDING_INDEPENDENT_JUDGE','namedProof':'NODEROOM-MOBILE-TABLE-EXPORT-01','request':'Make each repo ready for actual developer/user use, including visual/responsive/interaction proof; now execute.','authorization':'Parent approved exact seven-path plan SHA08ebb51b40d65d7d5ff43d7d875bbd97dabfec2d0b67f55baa7196044020dfb0; Excel limits/optional abort guard explicitly clarified; existing export-span wrapping corrected inside the same viewed CHANGE A boundary.','candidate':freeze['candidate'],'baseCommit':freeze['baseCommit'],'branch':freeze['branch'],'sourceDigest':freeze['source']['sourceDigest'],'sourceDigestFormula':freeze['source']['sourceDigestFormula'],'scope':freeze['source']['scope'],'state':freeze['state'],'freeze':{'path':'E6f-noderoom-mobile-export-repair/freeze.json','sha256':sha((O/'freeze.json').read_bytes())},'artifactManifest':{'path':'E6f-noderoom-mobile-export-repair/artifact-manifest.json','sha256':sha((O/'artifact-manifest.json').read_bytes()),'count':len(manifest)},'proof':{'existingMemoryChecks':29,'targetedWorkbookDialogTests':8,'browserScenarios':8,'actualMobileFilesReopened':19,'finalPngs':40,'perBrowserSourceBindings':12,'capturedSourceFiles':14,'protectedOldInputsUnchanged':1561,'protectedOldInputsChanged':2,'generatedOutputsPreserved':485,'selectedBeforeArtifactsPreserved':len(before),'desktopWorksheetModelParity':'PASS including values/types/styles/rows/columns; existing Account blanks remain a defect','pageErrors':0,'commands':commands},'limits':['Uncommitted application source build consumer; embedded SHA is base identity, actual tested bytes are bound separately.','No npm installed CLI, native Office, provider, Convex, host-hook or production proof.','Natural phone only at <=760; wider mobile component explicitly forced after recording natural desktop.','Fallback fonts and browser-only doubled text; full UI grades remain null.','Existing half-height dialog requires scrolling; enlarged tabs and transient toast overlap remain reading limitations.','No held long-running loading pixels or serializer CPU cancellation claimed. Rapid native navigation and helper abort scenario are separate proofs.','Desktop before/after Account cells blank; separate two-lookup follow-on proposal, no silent repair.','Baseline floor COM timeout remains; no rerun or weakening.','Baseline dependency advisories, NodeSlide immutable release mismatch, missing Gemini nightly credential and absent design docs remain.','PPTX/history unavailable; sample state/claim labels unverified; edits reset after sheet close/reload.'],'preservedFailures':['Zero-download original consumer and all original3px boundaries','typecheck-01 unused import','browser-proof-01 deferred-import probe assumption; exact hash-reconstructed old test retained','browser-proof-02 filename overflow and filename-wrap-before3px boundary','Serializer-only lossy/control probes and lower-layer32768 acceptance limitation','Custody script ref-output representation mismatch, corrected with exact original command'],'metadataAfterProof':'HANDOFF prose finalized after desktop replay; desktop runtime/test bindings are unchanged. Final source digest separately binds final HANDOFF.','grades':{'visual':None,'responsive':None,'accessibility':None,'performance':None,'provider':None,'production':None},'next':'Independent judge only; current candidate source/dist remains frozen. No commit/push.'}
dump(P/'E6f_NODEROOM_MOBILE_EXPORT_REPAIR_RECEIPT.json',receipt)
print(json.dumps({'sourceDigest':receipt['sourceDigest'],'manifestCount':len(manifest),'manifestSha256':receipt['artifactManifest']['sha256'],'receiptSha256':sha((P/'E6f_NODEROOM_MOBILE_EXPORT_REPAIR_RECEIPT.json').read_bytes()),'beforeCount':len(before),'pngs':len(pngs),'downloads':len(downloads)}))
