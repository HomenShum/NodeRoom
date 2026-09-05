from pathlib import Path
import json, hashlib
O=Path(__file__).resolve().parent
C=Path('D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905')
paths=json.loads((O/'custody.json').read_text(encoding='utf-8'))['scope']
bindings={p:hashlib.sha256((C/p).read_bytes()).hexdigest() for p in paths}
(O/'desktop-final-source-bindings.json').write_text(json.dumps(bindings,indent=2)+'\n',encoding='utf-8',newline='\n')
s=(O/'observe-desktop-export.mjs').read_text(encoding='utf-8')
s=s.replace("sourceCommit: '2b3e5bd718b80747f32257a8b8af5f15e2310699', sourceBindings: '../../E6f-noderoom-first-run/source-before.json'", "baseCommit: '2b3e5bd718b80747f32257a8b8af5f15e2310699', sourceBindings: '../desktop-final-source-bindings.json', sourceState: 'Uncommitted seven-path candidate; original journey unchanged'")
(O/'observe-desktop-export-final.mjs').write_text(s,encoding='utf-8',newline='\n')
print(json.dumps({'paths':paths,'journeyChange':'none; report metadata binding only'}))
