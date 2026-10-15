#!/usr/bin/env python3
"""Append one cycle record to shack/logs/runs.jsonl."""
import argparse
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

OPS = Path(__file__).resolve().parent.parent

p = argparse.ArgumentParser()
p.add_argument("--cycle", required=True)
p.add_argument("--result", required=True, choices=["ok", "partial", "failed"])
p.add_argument("--tasks-run", type=int, default=0)
p.add_argument("--notes", default="")
p.add_argument("--started", help="ISO time the cycle started (default: now)")
a = p.parse_args()

tz = ZoneInfo(json.loads((OPS / "config.json").read_text())["timezone"])
now = datetime.now(tz).isoformat(timespec="minutes")
rec = {"cycle": a.cycle, "started": a.started or now, "finished": now,
       "result": a.result, "tasks_run": a.tasks_run, "notes": a.notes}
with open(OPS / "logs" / "runs.jsonl", "a") as f:
    f.write(json.dumps(rec) + "\n")
print(json.dumps(rec))
