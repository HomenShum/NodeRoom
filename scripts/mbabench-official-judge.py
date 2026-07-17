#!/usr/bin/env python3
"""Launch the pinned MBABench judge without letting blank YAML clobber credentials."""

from __future__ import annotations

import argparse
import os
import runpy
import sys
from pathlib import Path


PRESERVED_PREFIXES = ("BIZBENCHJUDGE_KEYS_",)


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--judge-root", required=True)
    command.add_argument("judge_args", nargs=argparse.REMAINDER)
    return command


def main() -> int:
    args = parser().parse_args()
    judge_root = Path(args.judge_root).resolve()
    judge_entrypoint = judge_root / "main_scripts" / "judge.py"
    if not judge_entrypoint.exists():
        raise FileNotFoundError(f"MBABench judge entrypoint not found: {judge_entrypoint}")

    os.chdir(judge_root)
    sys.path.insert(0, str(judge_root))
    from utils import misc_utils

    original_loader = misc_utils.load_project_configs

    def load_project_configs_preserving_credentials(verbose: bool = False):
        preserved = {
            key: value
            for key, value in os.environ.items()
            if value and key.startswith(PRESERVED_PREFIXES)
        }
        result = original_loader(verbose=verbose)
        os.environ.update(preserved)
        return result

    misc_utils.load_project_configs = load_project_configs_preserving_credentials
    forwarded = args.judge_args[1:] if args.judge_args[:1] == ["--"] else args.judge_args
    sys.argv = [str(judge_entrypoint), *forwarded]
    runpy.run_path(str(judge_entrypoint), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
