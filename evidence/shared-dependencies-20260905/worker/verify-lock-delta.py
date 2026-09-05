import hashlib
import json
from pathlib import Path

O=Path(__file__).parent
C=Path('D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905')
before=json.loads((O/'before-package-lock.json').read_text(encoding='utf-8'))
after=json.loads((C/'package-lock.json').read_text(encoding='utf-8'))
pkg=json.loads((C/'package.json').read_text(encoding='utf-8'))
oldpkg=json.loads((O/'before-package.json').read_text(encoding='utf-8'))
cohort=json.loads((O.parent/'E6f-noderoom-shared-dependency-recon-01/tiptap-cohort.json').read_text(encoding='utf-8'))
expected=json.loads(json.dumps(oldpkg))
for name in expected['dependencies']:
    if name.startswith('@tiptap/'): expected['dependencies'][name]='^3.30.4'
for name in ['engine','react-headless']:
    expected['dependencies']['@nodeslide/'+name]='file:vendor/nodeslide/nodeslide-'+name+'-0.2.2.tgz'
assert pkg==expected, 'extra manifest change'
assert after['packages']['']['dependencies']==pkg['dependencies']
allowed={''}|{'node_modules/'+name for name in cohort['current']}|{'node_modules/prosemirror-model','node_modules/prosemirror-view'}
delta=[]
for path in sorted(set(before['packages'])|set(after['packages'])):
    a,b=before['packages'].get(path),after['packages'].get(path)
    if a==b: continue
    assert path in allowed, 'unrelated row '+path
    delta.append({'path':path,'before':a,'after':b})
assert {x['path'] for x in delta}==allowed
assert before['packages']['node_modules/@tiptap/extension-unique-id/node_modules/uuid']==after['packages']['node_modules/@tiptap/extension-unique-id/node_modules/uuid']
for record in cohort['registry']:
    row=after['packages']['node_modules/'+record['name']]
    assert row['version']=='3.30.4'
    assert row['integrity']==record['integrity']
    assert row.get('peerDependencies',{})==record['peerDependencies']
    assert row.get('dependencies',{})==record['dependencies']
assert after['packages']['node_modules/prosemirror-model']['version']=='1.25.11'
assert after['packages']['node_modules/prosemirror-view']['version']=='1.41.9'
checks={'manifestExactlyApproved':True,'rootLockEqualsManifest':True,'allThirtyTiptapExactVersionAndRegistryMetadata':True,'onlyThirtyThreeIntendedRows':True,'allOtherRowsUnchanged':True,'nestedUuid1401Unchanged':True,'requiredModelViewMinimumsOnly':True,'noOverrideChanges':pkg['overrides']==oldpkg['overrides']}
result={'passed':all(checks.values()),'checks':checks,'changedRows':len(delta),'delta':delta,'finalFiles':[{'path':p,'sha256':hashlib.sha256((C/p).read_bytes()).hexdigest()} for p in ['package.json','package-lock.json']]}
(O/'final-lock-delta.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'passed':result['passed'],'checks':checks,'changedRows':len(delta),'finalFiles':result['finalFiles']}))
