# Spoke report format

Every spoke ends its reply with exactly one fenced `json` block:

```json
{
  "agent": "<academic-core|ledger-fi|social-ops|hustle-engine>",
  "result": "ok | partial | failed",
  "task_updates": [
    {"id": "T-0007", "phase": "done", "verify": {"check": "...", "passed": true, "evidence": "3 events created on Google Calendar"}, "notes": "..."}
  ],
  "new_tasks": [
    {"title": "...", "priority": 2, "due": "2026-10-20", "autonomy": "read|draft|write|external|human", "verify": {"check": "..."}, "goal_ref": "G-01"}
  ],
  "relay": [
    {"to": "ledger-fi", "fact": "Client 'Joe's Pizza' paid $200 retainer on 2026-10-07"}
  ],
  "hermes_drafts": 0,
  "alerts": [
    {"level": "info|warn|critical", "msg": "..."}
  ]
}
```

The spoke has already written its own `state.json` before replying. `relay` facts go to the hub only. The hub decides whether to pass them on.

## Writing for Hudson
Everything that reaches the world page is read by Hudson, a high-school student, every morning. So every `human` task title, alert `msg`, `summary` and `metrics.world.bubbles` line is plain English:
- No task or goal IDs (`T-0007`, `G-02`), file names (`SETUP.md`, `state.json`), env vars, agent IDs (`ledger-fi`), brand or folder IDs, or raw URLs. Use the character or the plain area name ("Grit", "money", "your social media business").
- Say what he can do: "Turn on M&T email alerts so Grit can see purchases" beats "No M&T alert emails found; bank feed not connected".
- Put a link he needs in a separate `link` field on the task or alert (`{"link": {"label": "Open Metricool", "url": "https://..."}}`), never inside the sentence.
- Bubbles are at most 28 characters and never repeat an alert word for word.
