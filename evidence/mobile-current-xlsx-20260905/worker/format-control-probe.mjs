import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const ExcelJS=createRequire('D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905/package.json')('exceljs');
const rows=[];
for(const [name,input] of [['CR','a\rb'],['CRLF','a\r\nb'],['NUL','a\0b'],['Tab','a\tb'],['LF','a\nb']]){
 const w=new ExcelJS.Workbook();w.addWorksheet('Probe').getCell('A1').value=input;const opened=new ExcelJS.Workbook();await opened.xlsx.load(await w.xlsx.writeBuffer());const output=opened.getWorksheet('Probe').getCell('A1').value;
 rows.push({name,inputCodePoints:[...input].map(c=>c.codePointAt(0)),outputCodePoints:[...output].map(c=>c.codePointAt(0)),exact:input===output});
}
await writeFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'format-control-probe.json'),JSON.stringify({scope:'Serializer only, not native Excel. Explains conservative mobile rejection; accepted LF and Tab stay literal.',rows},null,2));console.log(JSON.stringify(rows));
