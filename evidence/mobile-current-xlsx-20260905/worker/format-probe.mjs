import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const output=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire('D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905/package.json');
const ExcelJS=require('exceljs');
const cases=[['literal-leading-zero','00123'],['literal-formula','=1+1'],['xml-control','a'+String.fromCharCode(1)+'b'],['lone-surrogate',String.fromCharCode(0xd800)],['long-text','z'.repeat(32768)],['unicode-newline','采购\nreview']];
const report=[];
for(const [name,value] of cases){const row={name,length:value.length};try{const wb=new ExcelJS.Workbook();wb.addWorksheet('Probe').getCell('A1').value=value;const bytes=await wb.xlsx.writeBuffer();await writeFile(path.join(output,name+'.xlsx'),bytes);const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(bytes);const got=reopened.getWorksheet('Probe').getCell('A1');Object.assign(row,{byteCount:bytes.byteLength,exact:got.value===value,returnedLength:typeof got.value==='string'?got.value.length:null,type:got.type,formula:got.formula??null});}catch(error){row.error=String(error);}report.push(row);}
await writeFile(path.join(output,'format-probe.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
