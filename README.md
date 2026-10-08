# J.A.R.V.I.S. Ops

A hub-and-spoke team of Claude agents that runs school, money, social media clients and a Shopify store. It runs on its own three times a day.

**Live dashboard:** https://claude.ai/artifact/EF5JTPV7CQnZa2jJZ6aFnH (private to your Claude account) · fallback: [`jarvis-ops/dashboard/DASHBOARD.md`](jarvis-ops/dashboard/DASHBOARD.md)

**First time?** Do [SETUP.md](SETUP.md).

## Architecture

```
            Claude Routine (05:46 · 15:16 · 20:46 America/New_York)
                                  │
                         ┌────────▼────────┐
                         │       HUB       │  plan → verify → execute → verify
                         │ hub/DIRECTOR.md │  only writer of state/tasks.json
                         └────────┬────────┘
     ┌───────────────┬────────────┴──┬────────────────┐   parallel, no cross-talk
┌────▼────────┐ ┌────▼─────┐ ┌───────▼────┐ ┌─────────▼─────┐
│Academic-Core│ │Ledger-Fi │ │ Social-Ops │ │ Hustle-Engine │
│ Classroom   │ │ M&T alert│ │ Metricool  │ │ Shopify,      │
│ emails, GCal│ │ emails   │ │            │ │ web research  │
└─────────────┘ └──────────┘ └────────────┘ └───────────────┘
                                  │
          commit → ops/state branch → dashboard re-render → live page
```

| Agent | Priority | Does automatically | Never does |
|---|---|---|---|
| Academic-Core | 40% | Reads forwarded Classroom emails, tracks deadlines, puts spaced-repetition study blocks on Google Calendar, writes Quizlet import files | Touch the school account |
| Social-Ops | 25% | Syncs clients from Metricool, drafts and schedules posts, weekly reports, invoice drafts, finds prospects and drafts DMs | Send DMs, like, follow or comment |
| Ledger-Fi | 20% | Rebuilds month-to-date income and spending from M&T alert emails, categorizes, tracks savings goals, flags unusual charges | Move money, store account numbers |
| Hustle-Engine | 15% | Store pulse (orders, revenue, low stock), arbitrage research with margin math, improvement ideas, DM drafts | Buy, change prices, publish |

## Layout

```
jarvis-ops/
├── config.json              settings from the setup questionnaire
├── hub/DIRECTOR.md          the hub's cycle procedure
├── hub/RULEBOOK.md          autonomy, privacy and failure rules
├── agents/<name>/SPEC.md    each spoke's job
├── agents/<name>/state.json each spoke's latest summary (no raw data)
├── agents/<name>/outbox/    Quizlet sets, reports, research notes
├── state/tasks.json         shared task list (hub writes it)
├── dashboard/               template.html → dashboard.html + DASHBOARD.md
├── logs/runs.jsonl          one line per cycle
├── scripts/                 validate.py, render_dashboard.py, log_run.py, install-hooks.sh
└── private/                 gitignored scratch space for raw data
.githooks/                   pre-commit, post-commit, pre-push
```

## Commands

```sh
python3 jarvis-ops/scripts/validate.py          # check state files
python3 jarvis-ops/scripts/render_dashboard.py  # rebuild DASHBOARD.md + dashboard.html
sh jarvis-ops/scripts/install-hooks.sh          # enable git hooks in a clone
```

To change a setting (cycle times, priority split, savings targets, autonomy), edit `jarvis-ops/config.json` or ask Claude to.

The previous Windows voice app (Gemini Live HUD) was removed. It is still in git history at commit `d10cf7a`.
