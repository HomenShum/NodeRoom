import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root='D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905';
const packet=path.dirname(fileURLToPath(import.meta.url));
const output=path.join(packet,'filename-wrap-before'); await mkdir(output);
const {chromium}=createRequire(path.join(root,'package.json'))('playwright');
const hash=b=>createHash('sha256').update(b).digest('hex');
const source=await readFile(path.join(root,'src/ui/mobile/MobileGrid.tsx'));
await writeFile(path.join(output,'MobileGrid.tsx.txt'),source);
const env={...process.env}; for(const key of Object.keys(env)) if(/^(VITE_|VERCEL_|CONVEX_|OPENAI_|OPENROUTER_|ANTHROPIC_|GOOGLE_GENERATIVE_|GITHUB_SHA)/.test(key)) delete env[key];
const base='http://127.0.0.1:54431'; let ready=false,browser;
const server=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','54431','--strictPort'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let serverLog=''; server.stdout.on('data',b=>{serverLog+=b; if(String(b).includes(base))ready=true;});server.stderr.on('data',b=>serverLog+=b);
const report={sourceSha256:hash(source),sourcePath:'src/ui/mobile/MobileGrid.tsx',viewport:{width:320,height:844},baseCommit:'2b3e5bd718b80747f32257a8b8af5f15e2310699',state:'Current candidate before filename wrapping correction',errors:[]};
try {
 const deadline=Date.now()+30000; while(!ready){if(Date.now()>deadline||server.exitCode!==null)throw Error('Owned preview not ready');await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:report.viewport});
 await page.route('**/*',route=>new URL(route.request().url()).origin===base||/^(blob|data):/.test(route.request().url())?route.continue():route.abort('blockedbyclient'));
 await page.goto(base+'/?mode=memory');await page.locator('.na-rcard[data-kind="sheet"]').first().click();
 const dialog=page.getByRole('dialog',{name:'Spreadsheet',exact:true}); await dialog.locator('.na-art-tab').filter({hasText:/^Sheet/}).click();
 await dialog.locator('button.v[title="Tap to edit"]').first().click();await dialog.locator('.na-sfield-edit').fill('00123 采购 <sample> 320');await dialog.locator('.na-sfield-edit').press('Enter');
 await dialog.locator('.na-art-tab').filter({hasText:/^Export$/}).click();const downloadEvent=page.waitForEvent('download');await dialog.getByTestId('mobile-table-export-download').click();const download=await downloadEvent;await download.saveAs(path.join(output,'current-before.xlsx'));
 await page.locator('.na-toast[data-show="true"]').waitFor({state:'hidden'});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const html=await page.content();await writeFile(path.join(output,'before.html'),html);report.beforePngSha256=hash(await page.screenshot({path:path.join(output,'before.png'),caret:'initial'}));
 report.measurements=await dialog.getByTestId('mobile-table-export-status').evaluate(e=>{const span=e.querySelector('.na-export-main span'),range=document.createRange();range.selectNodeContents(span);return {card:e.getBoundingClientRect().toJSON(),column:span.getBoundingClientRect().toJSON(),textRects:[...range.getClientRects()].map(r=>r.toJSON()),badge:e.lastElementChild.getBoundingClientRect().toJSON()};});
 await page.evaluate(rect=>{const overlay=document.createElement('div');overlay.id='worker-change-boundary';overlay.style.cssText=`position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;border:3px solid #d60078;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;const label=document.createElement('span');label.textContent='CHANGE A · filename wrap';label.style.cssText='position:absolute;bottom:calc(100% + 3px);left:0;background:#d60078;color:white;font:700 12px Arial;padding:4px;white-space:nowrap';overlay.append(label);document.body.append(overlay);},report.measurements.card);
 report.boundaryPngSha256=hash(await page.screenshot({path:path.join(output,'change-boundary.png'),caret:'initial'}));await page.locator('#worker-change-boundary').evaluate(e=>e.remove());report.domRestored=(await page.content())===html;if(!report.domRestored)throw Error('Overlay changed DOM');
 await writeFile(path.join(output,'change-boundary.md'),'# CHANGE A: current export filename\n\nThe current exported filename has no break opportunity and exceeds the existing text column at320px. Apply overflow-wrap:anywhere only to the existing export metadata span. Preserve card columns, badge, action, modal and other tabs. This is the already approved export owner; no broader layout change. The labelled box is3px and the original DOM was restored exactly.\n');
 if(hash(await readFile(path.join(root,'src/ui/mobile/MobileGrid.tsx')))!==report.sourceSha256)throw Error('Source changed');report.status='OBSERVED';
} catch(error){report.status='FAILED';report.errors.push(String(error));}
finally{if(browser)await browser.close();if(server.exitCode===null)spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true});await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));await writeFile(path.join(output,'server.log'),serverLog);await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));process.exitCode=report.status==='FAILED'?1:0;
