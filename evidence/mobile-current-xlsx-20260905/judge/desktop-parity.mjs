import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const O=path.dirname(fileURLToPath(import.meta.url));
const R='D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905';
const ExcelJS=createRequire(path.join(R,'package.json'))('exceljs');
const paths=['../E6f-noderoom-mobile-export-repair/desktop-baseline-export-01/Q3_variance.xlsx','../E6f-noderoom-mobile-export-repair/desktop-final-export/Q3_variance.xlsx','desktop-replay/Q3_variance.xlsx'];
const outputs=[];
for(const file of paths){const b=await readFile(path.join(O,file));const w=new ExcelJS.Workbook();await w.xlsx.load(b);outputs.push({file,sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length,sheets:w.worksheets.map(s=>s.model)});}
const checks=[{name:'Worker final and fresh independent download equal every baseline worksheet model',pass:outputs.slice(1).every(x=>JSON.stringify(x.sheets)===JSON.stringify(outputs[0].sheets))},{name:'All actual desktop workbooks reopen as 6631 bytes',pass:outputs.every(x=>x.bytes===6631)}];
const report={status:checks.every(x=>x.pass)?'PASS':'FAIL',checks,outputs,scope:'Full worksheet values, types, styles, rows and columns; ZIP creation timestamps not equal or claimed. Same inherited five blank Account cells remain a separate defect. Native Excel not run.'};
await writeFile(path.join(O,'desktop-parity.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks,outputs:outputs.map(({sheets,...x})=>x)}));process.exitCode=report.status==='PASS'?0:1;
