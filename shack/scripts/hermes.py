#!/usr/bin/env python3
"""Hermes: cheap bulk drafting for The Shack's agents.

Spokes hand repetitive drafting (flashcards, caption variations, hashtags, DM
first drafts) to a Nous Research Hermes model through OpenRouter, then review
the result themselves. That saves Claude usage for the work that matters.

  hermes.py status
      Prints {"available": bool, "model": ..., "reason": ...} and exits 0.
  hermes.py draft --task "Write 25 Quizlet cards ..." [--input FILE] [--max-tokens N]
      Prints the draft to stdout. Exit code 3 means Hermes is unavailable:
      the caller should do the work itself.

Needs the environment variable OPENROUTER_API_KEY (free OpenRouter account) and
network access to openrouter.ai. Model choice: config.json → hermes.model
("auto" picks a free Hermes model, else the cheapest Hermes model).
Every call is appended to shack/private/hermes-usage.log (gitignored).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

OPS = Path(__file__).resolve().parent.parent
API = "https://openrouter.ai/api/v1"
UNAVAILABLE = 3


def config():
    try:
        return json.loads((OPS / "config.json").read_text()).get("hermes", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def request(path, body=None, key=None, timeout=60):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {key}"} if key else {}),
                                          "HTTP-Referer": "https://github.com/hudsonshack/The-Shack",
                                          "X-Title": "The Shack"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def pick_model(cfg):
    want = cfg.get("model", "auto")
    if want and want != "auto":
        return want
    models = request("/models", timeout=20).get("data", [])
    hermes = [m for m in models if "hermes" in m.get("id", "").lower()]
    if not hermes:
        raise RuntimeError("no Hermes model listed on OpenRouter")
    free = [m for m in hermes if m["id"].endswith(":free")]
    if free:
        return sorted(free, key=lambda m: -int(m.get("context_length") or 0))[0]["id"]
    price = lambda m: float((m.get("pricing") or {}).get("completion") or 1e9)
    return sorted(hermes, key=price)[0]["id"]


def check():
    cfg = config()
    if not cfg.get("enabled", True):
        return {"available": False, "reason": "disabled in config.json"}
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        return {"available": False, "reason": "OPENROUTER_API_KEY is not set in the environment"}
    try:
        model = pick_model(cfg)
    except urllib.error.URLError as e:
        return {"available": False, "reason": f"cannot reach openrouter.ai ({e.reason}); allow the domain in the environment's network settings"}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": str(e)}
    return {"available": True, "model": model}


def log(entry):
    p = OPS / "private" / "hermes-usage.log"
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "a") as f:
        f.write(json.dumps(entry) + "\n")


def draft(task, input_text, max_tokens):
    st = check()
    if not st["available"]:
        print(f"HERMES_UNAVAILABLE: {st['reason']}", file=sys.stderr)
        sys.exit(UNAVAILABLE)
    system = ("You are a drafting assistant for a small business and a high-school student. "
              "Write exactly what is asked, in plain text, with no preamble. Never invent facts "
              "that are not in the input; leave a [TODO] where a fact is missing.")
    user = task + (f"\n\nINPUT:\n{input_text}" if input_text else "")
    t0 = time.time()
    try:
        out = request("/chat/completions", {
            "model": st["model"], "max_tokens": max_tokens, "temperature": 0.7,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }, key=os.environ["OPENROUTER_API_KEY"], timeout=120)
        text = out["choices"][0]["message"]["content"]
    except Exception as e:  # noqa: BLE001
        print(f"HERMES_UNAVAILABLE: request failed ({e})", file=sys.stderr)
        sys.exit(UNAVAILABLE)
    usage = out.get("usage", {})
    log({"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "model": st["model"], "secs": round(time.time() - t0, 1),
         "prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"),
         "task": task[:120]})
    print(text)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    d = sub.add_parser("draft")
    d.add_argument("--task", required=True)
    d.add_argument("--input")
    d.add_argument("--max-tokens", type=int, default=1500)
    a = p.parse_args()
    if a.cmd == "status":
        print(json.dumps(check()))
    else:
        draft(a.task, Path(a.input).read_text() if a.input else "", a.max_tokens)


if __name__ == "__main__":
    main()
