import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
out = Path(__file__).parent
candidate = Path(r"D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905")
label, budget, *command = sys.argv[1:]
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
log = out / f"{label}.log"
receipt = out / f"{label}.command.json"
assert not log.exists() and not receipt.exists(), "preserve earlier command artifacts"
begin = time.monotonic()
environment = os.environ.copy()
for key in list(environment):
    if key.startswith(("VITE_", "VERCEL_", "CONVEX_", "OPENAI_", "OPENROUTER_", "ANTHROPIC_", "GOOGLE_GENERATIVE_", "GITHUB_SHA", "NODESLIDE_ROOT", "PLAYWRIGHT_", "PRODUCT_MEMORY_")):
        environment.pop(key)
with log.open("wb") as handle:
    process = subprocess.Popen(command, cwd=candidate, env=environment, stdout=handle, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        code = process.wait(timeout=int(budget))
        timeout = False
    except subprocess.TimeoutExpired:
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=20)
        process.wait(timeout=20)
        code, timeout = process.returncode, True
result = {"startedAt": started, "finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "cwd": str(candidate), "argv": command, "timeoutSeconds": int(budget), "timedOut": timeout, "exitCode": code, "elapsedSeconds": round(time.monotonic() - begin, 3), "log": str(log), "environmentPolicy": "Remove inherited provider/Vite/Convex/CI-SHA/proof-server variables without outputting values; no env files copied"}
receipt.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result))
sys.exit(1 if timeout else code)
