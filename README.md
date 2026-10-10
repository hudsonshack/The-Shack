# The Shack

A little pixel world where Hudson's AI agents live and work. A hub-and-spoke team of Claude agents runs school, money, social media clients and the fidget store once a day at 11 AM, and you can watch them do it.

**Open the world:** https://claude.ai/artifact/EF5JTPV7CQnZa2jJZ6aFnH (private to your Claude account) · text fallback: [`shack/dashboard/DASHBOARD.md`](shack/dashboard/DASHBOARD.md)

**First time?** Do [SETUP.md](SETUP.md).

## The world

Five floating islands in starry space. Every island connects only to Clockspire, so the hub-and-spoke rule is something you can see.

```
   ✦        ·          ✦      ·            ·     ✦
     ╭────────────╮                    ╭────────────╮
     │Lantern Peak│~kite~╮      ╭~blimp~│ Neon Hollow│
     │ Abbot Quill│      │      │       │    Lumi    │
     ╰─────▽──────╯   ╭──┴──────┴──╮    ╰─────▽──────╯
          ▽ ▽         │ Clockspire │         ▽ ▽
     ·                │ Mayor Tock │                ✦
     ╭────────────╮   ╰──┬──────┬──╯    ╭────────────╮
     │ Spindrift  │~ship~╯      ╰=rail==│ Copperhold │
     │ Harbor     │                     │Grit · 💎💎💎│
     ╰─────▽──────╯                     ╰─────▽──────╯
   ✦        ·      🪐             🌙         ·      ✦
```

| Island | Character | Agent | What it does | Never does |
|---|---|---|---|---|
| Clockspire | Mayor Tock | Director (hub) | Rings the bell at 11:00 AM, skips idle agents, plans, verifies, writes the Chronicle recaps, sends the morning brief and urgent pushes, answers the quest board | — |
| Lantern Peak | Abbot Quill | Academic-Core · 40% | Classroom deadlines, spaced-repetition study blocks on Google Calendar, Quizlet sets | Touch the school account |
| Neon Hollow | Lumi | Social-Ops · 35% | Angie's: auto-edits new footage into finished posts, schedules them once the owner approves, reports | Send DMs, launch paid ads |
| Copperhold | Grit Copperpot | Ledger-Fi · 20% | Income and spending from M&T alerts, Friday paychecks, savings crystals (Invest, Car insurance, Apartment fund) | Move money, store account numbers |
| Spindrift Harbor | Cap'n Twirl | Hustle-Engine · 5% | Fidgetly on hold: nightly store check only | Buy, change prices, publish |

In the world: day and night follow New York time, the moon shows its real phase, weather over an island shows its status, islands grow as goals progress, and agents fly, sail or ride to Clockspire for each cycle. Click anything for its data. The **Chronicle** has daily, weekly and monthly recaps. The **quest board** takes your requests.

**Hermes** (a free Nous Research model, through OpenRouter) handles bulk drafting when it's set up (see SETUP.md step 6). Claude reviews everything it writes.

## How it runs

```
Claude Routine "The Shack Operations" (11:00 America/New_York, once a day)
  → hub/ROUTINE.md → hub/DIRECTOR.md: quest board intake → plan → skip idle spokes → verify
  → active spokes in parallel (Hermes drafts, Claude reviews) → verify → recaps → push notifications
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
├── state/recaps.json        daily / weekly / monthly Chronicle entries
├── world/                   the pixel world: shell.html + src/*.js → world.html (legacy/ = v1 art)
│   ├── WORLD_SPEC.md        art direction and module contract
│   └── tools/preview.mjs    headless screenshot preview
├── dashboard/DASHBOARD.md   markdown fallback
├── logs/runs.jsonl          one line per cycle
├── scripts/                 validate.py, render_dashboard.py, log_run.py, hermes.py, install-hooks.sh
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
