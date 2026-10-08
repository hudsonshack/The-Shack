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
