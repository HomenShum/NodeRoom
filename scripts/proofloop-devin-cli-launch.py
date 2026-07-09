import argparse
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--export", required=True)
    parser.add_argument("--run-dir")
    parser.add_argument("--timeout-seconds", type=int, default=int(os.environ.get("PROOFLOOP_DEVIN_CLI_TIMEOUT_SECONDS", "180")))
    args = parser.parse_args()

    prompt_path = Path(args.prompt_file)
    export_path = Path(args.export)
    run_dir = args.run_dir
    if not prompt_path.exists():
        print(f"prompt file missing: {prompt_path}", file=sys.stderr)
        return 2

    export_path.parent.mkdir(parents=True, exist_ok=True)
    started_at = utc_now()
    if os.environ.get("PROOFLOOP_DEVIN_CLI_DRY_RUN") == "1":
        transcript = {
            "schema": "proofloop-devin-cli-session-export-v1",
            "host": "devin-cli",
            "startedAt": started_at,
            "finishedAt": utc_now(),
            "runDir": args.run_dir,
            "promptPath": str(prompt_path),
            "command": "devin --prompt-file <prompt> --print --export <export>",
            "exitCode": 0,
            "timedOut": False,
            "stdout": "dry-run Devin CLI session\n",
            "stderr": "",
            "temporarilyDisabledMcps": [],
            "dryRun": True,
        }
        export_path.write_text(json.dumps(transcript, indent=2) + "\n", encoding="utf8")
        sys.stdout.write(transcript["stdout"])
        return 0

    command = ["devin"]
    config_path = os.environ.get("PROOFLOOP_DEVIN_CLI_CONFIG")
    if config_path:
        command.extend(["--config", config_path])
    command.extend(["--prompt-file", str(prompt_path), "--print", "--export", str(export_path)])
    env = os.environ.copy()
    devin_bin = Path(env.get("LOCALAPPDATA", "")) / "devin" / "cli" / "bin"
    env["PATH"] = f"{devin_bin};{env.get('PATH', '')}"

    if os.name == "nt":
        disabled_mcps = temporarily_disable_mcps(env)
        try:
            result = run_with_winpty(command, env, Path.cwd(), args.timeout_seconds)
        finally:
            restore_mcps(env, disabled_mcps)
    else:
        disabled_mcps = temporarily_disable_mcps(env)
        try:
            result = run_direct(command, env, Path.cwd(), args.timeout_seconds)
        finally:
            restore_mcps(env, disabled_mcps)
    finished_at = utc_now()

    transcript = {
        "schema": "proofloop-devin-cli-session-export-v1",
        "host": "devin-cli",
        "startedAt": started_at,
        "finishedAt": finished_at,
        "runDir": run_dir,
        "promptPath": str(prompt_path),
        "command": "devin --prompt-file <prompt> --print --export <export>",
        "exitCode": result["exitCode"],
        "timedOut": result["timedOut"],
        "stdout": result["stdout"],
        "stderr": result["stderr"],
        "temporarilyDisabledMcps": disabled_mcps,
    }
    export_path.write_text(json.dumps(transcript, indent=2) + "\n", encoding="utf8")
    sys.stdout.buffer.write(result["stdout"].encode("utf-8", errors="replace"))
    sys.stderr.buffer.write(result["stderr"].encode("utf-8", errors="replace"))
    return int(result["exitCode"] if result["exitCode"] is not None else 1)


def run_direct(command, env, cwd, timeout_seconds):
    try:
        completed = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout_seconds)
        return {
            "exitCode": completed.returncode,
            "timedOut": False,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }
    except subprocess.TimeoutExpired as error:
        return {
            "exitCode": 124,
            "timedOut": True,
            "stdout": error.stdout or "",
            "stderr": (error.stderr or "") + f"\nDevin CLI timed out after {timeout_seconds}s.\n",
        }


def run_with_winpty(command, env, cwd, timeout_seconds):
    try:
        from winpty import PtyProcess
    except Exception as error:
        return {
            "exitCode": 2,
            "timedOut": False,
            "stdout": "",
            "stderr": f"pywinpty is required for Devin CLI headless launch on Windows: {error}\n",
        }

    proc = PtyProcess.spawn(command, cwd=str(cwd), env=env)
    output = []
    done = False

    def reader():
        while not done:
            try:
                chunk = proc.read(4096)
            except EOFError:
                break
            except Exception as error:
                output.append(f"\nPTY read error: {error}\n")
                break
            if chunk:
                output.append(chunk)
            else:
                time.sleep(0.1)

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    deadline = time.time() + timeout_seconds
    timed_out = False
    while time.time() < deadline:
        if not proc.isalive():
            break
        time.sleep(0.2)
    if proc.isalive():
        timed_out = True
        proc.terminate(force=True)
    done = True
    thread.join(timeout=2)
    text = "".join(output)
    exit_code = 124 if timed_out else getattr(proc, "exitstatus", None)
    stderr = f"\nDevin CLI timed out after {timeout_seconds}s.\n" if timed_out else ""
    return {
        "exitCode": exit_code if exit_code is not None else 1,
        "timedOut": timed_out,
        "stdout": text,
        "stderr": stderr,
    }


def temporarily_disable_mcps(env):
    requested = csv(env.get("PROOFLOOP_DEVIN_CLI_DISABLE_MCPS", ""))
    if not requested:
        return []
    enabled = currently_enabled_mcps(env, requested)
    for name in enabled:
        subprocess.run(["devin", "mcp", "disable", name], env=env, capture_output=True, text=True, timeout=30)
    return enabled


def restore_mcps(env, names):
    for name in names:
        subprocess.run(["devin", "mcp", "enable", name], env=env, capture_output=True, text=True, timeout=30)


def currently_enabled_mcps(env, targets):
    try:
        completed = subprocess.run(["devin", "mcp", "list"], env=env, capture_output=True, text=True, timeout=30)
    except Exception:
        return targets
    enabled = []
    for line in completed.stdout.splitlines():
        stripped = line.strip()
        for target in targets:
            if target in stripped and "(disabled)" not in stripped:
                enabled.append(target)
    return enabled


def csv(value):
    return [item.strip() for item in value.split(",") if item.strip()]


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


if __name__ == "__main__":
    raise SystemExit(main())
