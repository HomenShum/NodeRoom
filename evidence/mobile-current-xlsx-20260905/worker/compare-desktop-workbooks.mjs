import { createRequire } from 'node:module';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const O=path.dirname(fileURLToPath(import.meta.url));
const C='D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905';
const ExcelJS=createRequire(path.join(C,'package.json'))('exceljs');
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=['desktop-baseline-export-01/Q3_variance.xlsx','desktop-final-export/Q3_variance.xlsx'];
const models=[];
for(const file of files){const bytes=await readFile(path.join(O,file));const w=new ExcelJS.Workbook();await w.xlsx.load(bytes);models.push({path:file,sha256:hash(bytes),byteCount:bytes.length,sheets:w.worksheets.map(s=>s.model)});}
const equal=JSON.stringify(models[0].sheets)===JSON.stringify(models[1].sheets);
const report={status:equal?'PASS':'FAIL',method:'ExcelJS reopened worksheet models including cell values/types/styles/rows/columns; ZIP creation timestamps are not claimed equal',files:models,knownInheritedDefect:'Account labels are blank in both workbooks despite visible Revenue/COGS labels. Equality proves extraction parity, not complete desktop data.'};
await writeFile(path.join(O,'desktop-workbook-parity.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,files:models.map(({sheets,...rest})=>rest)}));process.exitCode=equal?0:1;
