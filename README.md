# The Shack

A little pixel world where Hudson's AI agents live and work. A hub-and-spoke team of Claude agents runs school, money, social media clients and the fidget store three times a day, and you can watch them do it.

**Open the world:** https://claude.ai/artifact/EF5JTPV7CQnZa2jJZ6aFnH (private to your Claude account) · text fallback: [`shack/dashboard/DASHBOARD.md`](shack/dashboard/DASHBOARD.md)

**First time?** Do [SETUP.md](SETUP.md).

## The world

```
 ┌──────────────────────────────────────────────────────────────┐
 │≈≈│ ▲▲ Highland Monastery ▲▲ │ School │  Neon Night Market ✦✦  │
 │≈≈│    Abbot Quill           │  Hill  │  Lumi                  │
 │≈≈│                   ┌──────┴────────┴──┐                      │
 │≈≈│ Hudson House Inn  │   Town Square    │   East Meadow        │
 │≈≈│                   │ Mayor Tock · ⏰  │                      │
 │≈≈└┐                  └──────┬───────────┘                      │
 │≈≈≈│ River Port Bazaar │ Savings Row │  Copperpot Mine ⛏       │
 │≈≈≈≈│ Cap'n Twirl      │ 🏗 🛡 🌳     │  Grit Copperpot         │
 └──────────────────────────────────────────────────────────────┘
   the Hudson
```

| Place | Character | Agent | What it does | Never does |
|---|---|---|---|---|
| Town Square | Mayor Tock | Director (hub) | Rings the bell at 5:45, 3:45 and 8:45, plans the cycle, hands out work, verifies results, answers your quest board | — |
| Highland Monastery | Abbot Quill | Academic-Core · 40% | Reads forwarded Classroom emails, tracks deadlines, puts spaced-repetition study blocks on Google Calendar, writes Quizlet import files | Touch the school account |
| Neon Night Market | Lumi | Social-Ops · 25% | Runs Angie's and the fidget store's socials through Metricool, plans TikTok/Reels/Shorts videos, weekly reports, invoice drafts, prospect DM drafts | Send DMs, launch paid ads |
| Copperpot Mine + Savings Row | Grit Copperpot | Ledger-Fi · 20% | Rebuilds income and spending from M&T alert emails, Friday paychecks, savings goals (apartment, car insurance, investing), odd charges | Move money, store account numbers |
| River Port Bazaar | Cap'n Twirl | Hustle-Engine · 15% | Fidget store pulse (orders, revenue, low stock), arbitrage research, product facts for Lumi's videos | Buy, change prices, publish |

In the world: day and night follow New York time, seasons follow the calendar, weather over a biome shows its status (rain for warnings, storms for critical), biomes grow as goals progress, and the agents walk to the square for each cycle. Click anything for its data. Post requests on the **quest board** and Mayor Tock picks them up next cycle.

## How it runs

```
Claude Routine "The Shack: Director cycle" (05:45 · 15:45 · 20:45 America/New_York)
  → hub/DIRECTOR.md: quest board intake → plan → verify → 4 spokes in parallel → verify
  → commit to ops/state → render DASHBOARD.md + world.html → republish the world page
```

## Layout

```
shack/
├── config.json              settings from the setup questionnaires
├── hub/DIRECTOR.md          Mayor Tock's cycle procedure
├── hub/RULEBOOK.md          autonomy, privacy and failure rules
├── agents/<name>/SPEC.md    each spoke's job
├── agents/<name>/state.json each spoke's latest summary (no raw data)
├── agents/<name>/outbox/    Quizlet sets, video plans, reports, research
├── state/tasks.json         shared task list (only the hub writes it)
├── world/                   the pixel world: shell.html + src/*.js → world.html
│   ├── WORLD_SPEC.md        art direction and module contract
│   └── tools/preview.mjs    headless screenshot preview
├── dashboard/DASHBOARD.md   markdown fallback
├── logs/runs.jsonl          one line per cycle
├── scripts/                 validate.py, render_dashboard.py, log_run.py, install-hooks.sh
└── private/                 gitignored scratch space for raw data
.githooks/                   pre-commit, post-commit, pre-push
```

## Commands

```sh
python3 shack/scripts/validate.py                       # check state files
python3 shack/scripts/render_dashboard.py               # rebuild DASHBOARD.md + world.html
node shack/world/tools/preview.mjs --out /tmp/w.png     # screenshot the world (add --sample, --time, --season)
sh shack/scripts/install-hooks.sh                       # enable git hooks in a clone
```

To change a setting (cycle times, priority split, savings targets, autonomy), edit `shack/config.json` or ask Claude to.
