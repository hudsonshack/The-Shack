#!/usr/bin/env python3
"""Render The Shack from state files.

Writes:
  shack/dashboard/DASHBOARD.md   markdown tables (readable on GitHub)
  shack/world/world.html         the pixel world, published as the live Artifact
                                 (shell.html + src/*.js + state data, in one file)
"""
import json
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

OPS = Path(__file__).resolve().parent.parent
REPO = OPS.parent
DASH = OPS / "dashboard"
WORLD = OPS / "world"
AGENTS = ("academic-core", "ledger-fi", "social-ops", "hustle-engine")
OPEN = ("plan", "verify", "execute", "blocked")


def read_json(path, default):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def next_cycle(config, now):
    tz = ZoneInfo(config["timezone"])
    local = now.astimezone(tz)
    for day in range(2):
        for c in sorted(config["cycles"], key=lambda c: c["local_time"]):
            h, m = map(int, c["local_time"].split(":"))
            t = (local + timedelta(days=day)).replace(hour=h, minute=m, second=0, microsecond=0)
            if t > local:
                return {"name": c["name"], "at": t.isoformat()}
    return None


def recent_runs(limit=8):
    path = OPS / "logs" / "runs.jsonl"
    if not path.exists():
        return []
    rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    return rows[-limit:][::-1]


def recent_commits(limit=8):
    try:
        out = subprocess.run(
            ["git", "log", f"-{limit}", "--date=iso-strict", "--pretty=format:%h\x1f%ad\x1f%s"],
            cwd=REPO, capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    return [dict(zip(("sha", "at", "subject"), l.split("\x1f"))) for l in out.splitlines() if l]


def collect():
    config = read_json(OPS / "config.json", {})
    tasks = read_json(OPS / "state" / "tasks.json", {"goals": [], "tasks": []})
    agents = {a: read_json(OPS / "agents" / a / "state.json", {}) for a in AGENTS}
    now = datetime.now(ZoneInfo(config.get("timezone", "UTC")))
    threads = []
    for a in AGENTS:
        s = agents[a]
        mine = [t for t in tasks["tasks"] if t["agent"] == a]
        threads.append({
            "id": a,
            "label": config["agents"][a]["label"],
            "character": config["agents"][a].get("character"),
            "biome": config["agents"][a].get("biome"),
            "domain": config["agents"][a]["domain"],
            "phase": s.get("phase", "uninit"),
            "pending": sum(t["phase"] in ("plan", "verify", "execute") for t in mine),
            "blocked": sum(t["phase"] == "blocked" for t in mine),
            "done": sum(t["phase"] == "done" for t in mine),
            "last_run": s.get("last_run"),
            "summary": s.get("summary", ""),
            "weight": config["priority_weights"][a],
        })
    alerts = []
    for a in AGENTS:
        for al in agents[a].get("alerts", []):
            alerts.append({**al, "agent": config["agents"][a]["label"]})
    rank = {"critical": 0, "warn": 1, "info": 2}
    alerts.sort(key=lambda x: (rank.get(x.get("level"), 3), x.get("at") or ""))
    open_tasks = [t for t in tasks["tasks"] if t["phase"] in OPEN]
    open_tasks.sort(key=lambda t: (t["priority"], t.get("due") or "9999"))
    return {
        "generated": now.isoformat(timespec="minutes"),
        "system": config.get("system", "The Shack"),
        "timezone": config.get("timezone"),
        "next_cycle": next_cycle(config, now),
        "cycles": config.get("cycles", []),
        "autonomy": config.get("autonomy", {}),
        "threads": threads,
        "alerts": alerts,
        "tasks": open_tasks,
        "goals": tasks["goals"],
        "agents": {a: agents[a].get("metrics", {}) for a in AGENTS},
        "runs": recent_runs(),
        "commits": recent_commits(),
        "player": config.get("player", {}),
        "home_area": config.get("home_area"),
        "world": {k: v for k, v in config.get("world", {}).items() if k != "artifact_url"},
        "clients": config["agents"]["social-ops"].get("clients", []),
        "store": {"projects": config["agents"]["hustle-engine"].get("projects", []),
                  "ads": config["agents"]["social-ops"].get("store_ads", {})},
        "payday": config["agents"]["ledger-fi"].get("payday", {}),
        "savings_goals": config["agents"]["ledger-fi"].get("savings_goals", []),
        "weights": config.get("priority_weights", {}),
    }


def md_escape(s):
    return str(s if s is not None else "—").replace("|", "\\|").replace("\n", " ")


def table(headers, rows):
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += ["| " + " | ".join(md_escape(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def render_md(d):
    nc = d["next_cycle"]
    out = [
        f"# {d['system']} — Dashboard",
        "",
        f"`generated {d['generated']}` · `next cycle: {nc['name']} @ {nc['at']}`" if nc else f"`generated {d['generated']}`",
        "",
        "> Generated by `shack/scripts/render_dashboard.py`. Do not edit by hand.",
        "",
        "## Threads",
        "",
        table(["Thread", "Domain", "Phase", "Pending", "Blocked", "Done", "Last run", "Share"],
              [[t["label"], t["domain"], t["phase"], t["pending"], t["blocked"], t["done"],
                t["last_run"], f"{t['weight']}%"] for t in d["threads"]]),
        "",
        "## Alerts",
        "",
        table(["Level", "Agent", "Message", "At"],
              [[a.get("level"), a["agent"], a.get("msg"), a.get("at")] for a in d["alerts"]])
        if d["alerts"] else "_No alerts._",
        "",
        "## Open tasks",
        "",
        table(["ID", "Agent", "Task", "Phase", "P", "Due", "Autonomy"],
              [[t["id"], t["agent"], t["title"], t["phase"], t["priority"], t.get("due"), t["autonomy"]]
               for t in d["tasks"]]) if d["tasks"] else "_No open tasks._",
        "",
        "## Recent cycles",
        "",
        table(["Cycle", "Started", "Result", "Tasks run", "Notes"],
              [[r.get("cycle"), r.get("started"), r.get("result"), r.get("tasks_run"), r.get("notes")]
               for r in d["runs"]]) if d["runs"] else "_No cycles yet._",
        "",
        "## Commits",
        "",
        table(["SHA", "At", "Subject"], [[c["sha"], c["at"], c["subject"]] for c in d["commits"]]),
        "",
    ]
    return "\n".join(out)


def build_world(d):
    """One <script> per module, so an error in one module can't stop the others."""
    shell = (WORLD / "shell.html").read_text()
    scripts = []
    for f in sorted((WORLD / "src").glob("*.js")):
        code = f.read_text().replace("</script", "<\\/script")
        scripts.append(f"<script>/* {f.name} */\n{code}\n</script>")
    scripts.append("<script>SHACK.boot();</script>")
    blob = json.dumps(d, ensure_ascii=False).replace("</", "<\\/")
    return shell.replace("__SHACK_DATA__", blob).replace("__SHACK_SCRIPTS__", "\n".join(scripts))


def main():
    import sys
    d = collect()
    if "--data-json" in sys.argv:
        print(json.dumps(d, ensure_ascii=False))
        return
    (DASH / "DASHBOARD.md").write_text(render_md(d))
    (WORLD / "world.html").write_text(build_world(d))
    print("rendered:", (DASH / "DASHBOARD.md").relative_to(REPO), (WORLD / "world.html").relative_to(REPO))


if __name__ == "__main__":
    main()
