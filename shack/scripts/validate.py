#!/usr/bin/env python3
"""Validate The Shack state files and block secrets or private data.

Usage:
  validate.py            check every state file
  validate.py --staged   also scan the files staged for commit (pre-commit hook)
"""
import json
import re
import subprocess
import sys
from pathlib import Path

OPS = Path(__file__).resolve().parent.parent
REPO = OPS.parent
AGENTS = ("academic-core", "ledger-fi", "social-ops", "hustle-engine")
TASK_AGENTS = AGENTS + ("hub",)
PHASES = {"plan", "verify", "execute", "done", "blocked"}
AGENT_PHASES = {"uninit", "idle", "running", "error"}
AUTONOMY = {"read", "draft", "write", "external", "human"}
LEVELS = {"info", "warn", "critical"}

SECRET_PATTERNS = [
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "private key"),
    (re.compile(r"\b(sk|rk)-[A-Za-z0-9_-]{20,}"), "API secret key"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"), "GitHub token"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AWS access key"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"), "Google API key"),
    (re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"), "Slack token"),
    (re.compile(r"(?i)\b(password|passwd|api[_-]?key|secret)\s*[:=]\s*['\"]?[^\s'\"]{6,}"), "credential assignment"),
]
# Bank account / card numbers: long digit runs. Only checked in finance and private-adjacent files.
ACCOUNT_NUMBER = re.compile(r"(?<![\d.])\d{9,19}(?![\d.])")

errors = []


def err(where, msg):
    errors.append(f"{where}: {msg}")


def load(path):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        err(path.relative_to(REPO), "missing")
    except json.JSONDecodeError as e:
        err(path.relative_to(REPO), f"invalid JSON ({e})")
    return None


def check_tasks():
    path = OPS / "state" / "tasks.json"
    data = load(path)
    if data is None:
        return
    where = path.relative_to(REPO)
    goal_ids = {g.get("id") for g in data.get("goals", [])}
    seen = set()
    for t in data.get("tasks", []):
        tid = t.get("id", "?")
        w = f"{where} [{tid}]"
        if not re.fullmatch(r"T-\d{4,}", str(tid)):
            err(w, "id must look like T-0001")
        if tid in seen:
            err(w, "duplicate id")
        seen.add(tid)
        if t.get("agent") not in TASK_AGENTS:
            err(w, f"unknown agent {t.get('agent')!r}")
        if t.get("phase") not in PHASES:
            err(w, f"phase must be one of {sorted(PHASES)}")
        if t.get("autonomy") not in AUTONOMY:
            err(w, f"autonomy must be one of {sorted(AUTONOMY)}")
        if t.get("goal_ref") not in goal_ids:
            err(w, f"goal_ref {t.get('goal_ref')!r} is not a known goal")
        if t.get("priority") not in (1, 2, 3):
            err(w, "priority must be 1, 2 or 3")
        if not t.get("title"):
            err(w, "title is required")
        v = t.get("verify")
        if not isinstance(v, dict) or "check" not in v:
            err(w, "verify.check is required (plan, verify, execute loop)")
        if t.get("phase") == "done" and isinstance(v, dict) and v.get("passed") is not True:
            err(w, "a task can only be done after verify.passed is true")


def check_agents():
    for a in AGENTS:
        path = OPS / "agents" / a / "state.json"
        data = load(path)
        if data is None:
            continue
        where = path.relative_to(REPO)
        if data.get("agent") != a:
            err(where, f"agent field must be {a!r}")
        if data.get("phase") not in AGENT_PHASES:
            err(where, f"phase must be one of {sorted(AGENT_PHASES)}")
        if not isinstance(data.get("metrics"), dict):
            err(where, "metrics must be an object")
        for i, al in enumerate(data.get("alerts", [])):
            if al.get("level") not in LEVELS:
                err(where, f"alerts[{i}].level must be one of {sorted(LEVELS)}")


def check_config():
    data = load(OPS / "config.json")
    if data is None:
        return
    weights = data.get("priority_weights", {})
    if set(weights) != set(AGENTS):
        err("shack/config.json", "priority_weights must list all four agents")
    elif sum(weights.values()) != 100:
        err("shack/config.json", f"priority_weights add up to {sum(weights.values())}, not 100")


def check_recaps():
    path = OPS / "state" / "recaps.json"
    data = load(path)
    if data is None:
        return
    where = path.relative_to(REPO)
    for kind, keep in (("daily", 30), ("weekly", 12), ("monthly", 12)):
        items = data.get(kind)
        if not isinstance(items, list):
            err(where, f"{kind} must be a list")
            continue
        if len(items) > keep:
            err(where, f"{kind} keeps at most {keep} entries (has {len(items)})")
        for i, r in enumerate(items):
            if not isinstance(r, dict) or not r.get("period") or not r.get("chronicle"):
                err(where, f"{kind}[{i}] needs period and chronicle")
            elif not isinstance(r.get("stats", {}), dict):
                err(where, f"{kind}[{i}].stats must be an object")


def staged_files():
    out = subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
                         cwd=REPO, capture_output=True, text=True, check=True).stdout
    return [p for p in out.splitlines() if p]


def scan(paths):
    for rel in paths:
        if rel.startswith("shack/private/") and not rel.endswith("README.md"):
            err(rel, "files in shack/private/ must never be committed")
            continue
        p = REPO / rel
        if not p.is_file() or p.stat().st_size > 2_000_000:
            continue
        try:
            text = p.read_text()
        except UnicodeDecodeError:
            continue
        for rx, label in SECRET_PATTERNS:
            if rx.search(text):
                err(rel, f"looks like it contains a {label}")
        if rel.startswith("shack/agents/ledger-fi/") and ACCOUNT_NUMBER.search(text):
            err(rel, "contains a long digit run that may be an account or card number")


def main():
    check_config()
    check_tasks()
    check_agents()
    check_recaps()
    if "--staged" in sys.argv:
        scan(staged_files())
    if errors:
        print("The Shack validation failed:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(1)
    print("The Shack state OK")


if __name__ == "__main__":
    main()
