import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.request

O=Path(__file__).parent
C=Path('D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905')
node='C:/nvm4w/nodejs/node.exe'
port=54511
with socket.socket() as s:
    s.bind(('127.0.0.1',port))
env=os.environ.copy()
for key in list(env):
    if key.startswith(('VITE_','VERCEL_','CONVEX_','OPENAI_','OPENROUTER_','ANTHROPIC_','GOOGLE_GENERATIVE_','PLAYWRIGHT_','PRODUCT_MEMORY_')) or key=='CI': env.pop(key)
report=O/'notebook-browser'
report.mkdir(exist_ok=False)
config=report/'playwright.config.cjs'
config.write_text('module.exports = '+json.dumps({'testDir':str(C/'e2e'),'testMatch':'notebook-agent-notes.spec.ts','fullyParallel':False,'workers':1,'retries':0,'timeout':60000,'expect':{'timeout':7000},'reporter':[['json',{'outputFile':str(report/'results.json')}]],'outputDir':str(report/'artifacts'),'use':{'baseURL':f'http://127.0.0.1:{port}','browserName':'chromium','screenshot':'on','trace':'on','video':'off'}})+';\n',encoding='utf-8',newline='\n')
with (report/'server.log').open('wb') as log:
    server=subprocess.Popen([node,str(C/'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port',str(port),'--strictPort'],cwd=C,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        deadline=time.monotonic()+45
        while True:
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}',timeout=2) as response:
                    assert response.status==200
                break
            except Exception:
                if server.poll() is not None or time.monotonic()>deadline: raise
                time.sleep(.25)
        with (report/'run.log').open('wb') as output:
            result=subprocess.run([node,str(C/'node_modules/playwright/cli.js'),'test','--config',str(config)],cwd=C,env=env,stdout=output,stderr=subprocess.STDOUT,timeout=240)
        (report/'command.json').write_text(json.dumps({'exitCode':result.returncode,'port':port,'sourceSpec':'e2e/notebook-agent-notes.spec.ts','unchangedSpec':True,'route':'/?mode=memory&surface=desktop','widths':[1440,375,320],'serverMode':'built-preview','retries':0,'screenshots':'on','trace':'on','externalProviderSetup':False},indent=2)+'\n',encoding='utf-8',newline='\n')
    finally:
        subprocess.run(['taskkill','/PID',str(server.pid),'/T','/F'],capture_output=True,timeout=20)
        server.wait(timeout=20)
print(json.dumps({'exitCode':result.returncode,'report':str(report),'ownedServerClosed':True}))
raise SystemExit(result.returncode)
