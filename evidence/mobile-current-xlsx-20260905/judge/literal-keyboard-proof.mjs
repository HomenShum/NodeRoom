import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const O=path.join(path.dirname(fileURLToPath(import.meta.url)),'literal-keyboard');
const R='D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905';
const require=createRequire(path.join(R,'package.json'));
const {chromium}=require('playwright'); const ExcelJS=require('exceljs');
const B='http://127.0.0.1:54433';
const hash=b=>createHash('sha256').update(b).digest('hex');
await mkdir(O);
const source=JSON.parse(await readFile(path.join(O,'../../E6f-noderoom-mobile-export-repair/source-final.json'),'utf8'));
const result={status:'RUNNING',checks:[],files:[],captures:[],errors:[],externalRequests:[],sourceDigest:source.sourceDigest,scope:'Actual 390px memory/sample UI; no app response override; one explicit resource-failure injection; fallback fonts; browser pixel and XML/ExcelJS proof, not native Excel.'};
function check(name,pass,actual){result.checks.push({name,pass,actual});if(!pass)throw new Error(name);}
const env={...process.env};for(const k of Object.keys(env))if(/^(VITE_|VERCEL_|CONVEX_|OPENAI_|OPENROUTER_|ANTHROPIC_|GOOGLE_GENERATIVE_|GITHUB_SHA|PLAYWRIGHT_)/.test(k))delete env[k];
const log=createWriteStream(path.join(O,'server.log'));
const server=spawn(process.execPath,[path.join(R,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','54433','--strictPort'],{cwd:R,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
server.stdout.pipe(log);server.stderr.pipe(log);let ready=false;server.stdout.on('data',b=>{if(String(b).includes(B))ready=true});
let browser,page;
async function capture(name){
 await page.locator('.na-toast[data-show="true"]').waitFor({state:'hidden',timeout:10000});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const png=await page.screenshot({path:path.join(O,name+'.png')});const html=await page.content();await writeFile(path.join(O,name+'.html'),html);
 const dom=await page.evaluate(()=>({url:location.href,width:innerWidth,height:innerHeight,body:document.body.innerText,focused:document.activeElement?.outerHTML}));
 await writeFile(path.join(O,name+'.json'),JSON.stringify(dom,null,2));result.captures.push({name,pngSha256:hash(png),htmlSha256:hash(html)});
}
try{
 for(const [p,h]of Object.entries(source.capturedFiles))check('frozen input '+p,hash(await readFile(path.join(R,p)))===h);
 const deadline=Date.now()+30000;while(!ready){if(server.exitCode!==null)throw new Error('Owned server exited');if(Date.now()>deadline)throw new Error('Owned server did not start');await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===B||['blob:','data:'].includes(u.protocol))return route.continue();result.externalRequests.push(u.origin+u.pathname);return route.abort('blockedbyclient')});
 page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));const downloads=[];page.on('download',d=>downloads.push(d));
 await page.goto(B+'/?mode=memory',{waitUntil:'domcontentloaded'});await page.getByTestId('mobile-bottom-nav').waitFor();
 await page.locator('.na-rcard[data-kind="sheet"]').first().focus();await page.locator('.na-rcard[data-kind="sheet"]').first().press('Enter');
 const dialog=page.getByRole('dialog',{name:'Spreadsheet',exact:true});await dialog.waitFor();
 for(const [i,value]of ['=SUM(A1:A3)','00123'].entries()){
  await dialog.locator('.na-art-tab').filter({hasText:/^Sheet/}).click();await dialog.locator('button.v[title="Tap to edit"]').first().click();const edit=dialog.locator('.na-sfield-edit');await edit.fill(value);await edit.press('Enter');
  check('actual edited value '+i,await dialog.locator('button.v[title="Tap to edit"]').first().textContent()===value);
  await dialog.locator('.na-art-tab').filter({hasText:/^Export$/}).click();const button=dialog.getByTestId('mobile-table-export-download');
  if(i===0){
   await page.evaluate(()=>{const original=URL.createObjectURL;URL.createObjectURL=function(){URL.createObjectURL=original;throw new Error('Independent test: download resource unavailable.')}});
   await button.click();await dialog.getByRole('alert').filter({hasText:'download resource unavailable'}).waitFor();
   check('resource failure emits no file',downloads.length===0);check('failure has no success caption',!(await dialog.getByTestId('mobile-table-export-status').innerText()).includes('Download started'));
   await button.focus();
   const bounds=await button.evaluate(e=>{const r=e.getBoundingClientRect();return{focused:document.activeElement===e,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),rect:r.toJSON(),text:e.textContent}});
   check('retry can receive visible keyboard focus',bounds.focused&&bounds.hit,bounds);await capture('keyboard-retry-visible');
  }
  const event=page.waitForEvent('download');await button.focus();await button.press('Enter');const download=await event;const file=`literal-${i}.xlsx`;await download.saveAs(path.join(O,file));check('download completion '+i,await download.failure()===null);
  const bytes=await readFile(path.join(O,file));const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);const cell=workbook.getWorksheet('Current table').getCell('B2');
  check('exact literal cell '+i,cell.value===value,{expected:value,actual:cell.value});check('not an executable formula '+i,cell.formula===undefined&&cell.type===3,{type:cell.type});
  check('one explicit activation one file '+i,downloads.length===i+1);const status=await dialog.getByTestId('mobile-table-export-status').innerText();check('receipt bytes match actual file '+i,status.includes(bytes.length.toLocaleString()+' bytes'),{status,bytes:bytes.length});
  result.files.push({file,value,sha256:hash(bytes),bytes:bytes.length,sheets:workbook.worksheets.map(s=>({name:s.name,rows:s.getSheetValues()}))});await capture('literal-started-'+i);
 }
 check('no page errors',result.errors.length===0,result.errors);
 for(const [p,h]of Object.entries(source.capturedFiles))check('unchanged input '+p,hash(await readFile(path.join(R,p)))===h);
 result.status='PASS';
}catch(e){result.status='FAIL';result.error=String(e);if(page)try{await capture('failure')}catch{} }
finally{if(browser)await browser.close();if(server.exitCode===null)spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true});if(server.exitCode===null)await new Promise(r=>server.once('exit',r));log.end();await writeFile(path.join(O,'report.json'),JSON.stringify(result,null,2));}
console.log(JSON.stringify({status:result.status,checks:result.checks.length,files:result.files.length,output:O}));process.exitCode=result.status==='PASS'?0:1;
