# The Shack: handoff for a new Claude Code chat

Everything lives in this repo (`hudsonshack/The-Shack`). A new chat only needs this file. Last updated Oct 11, 2026.

## Starter message for the new chat
> Read HANDOFF.md, README.md and SETUP.md in this repo. You're continuing work on The Shack, my AI agent team and pixel world. Check the progress doc and Gmail for M&T alerts, then help me with the next thing on the "Waiting on you" list.

## Links
| What | Where |
|---|---|
| The world (the app) | https://claude.ai/artifact/86QegBn7tCzwcK18DrGVFQ (v3, published split: page + world.js + shack-data.js). The old link EF5JTPV7CQnZa2jJZ6aFnH is retired |
| Progress doc | https://claude.ai/artifact/3YbwBMEfwMNnDD5PzGzv8K (Claude Docs project `149bdcf4-2b31-4896-b333-0a3becedd514`) |
| Agent routine | "The Shack Operations", daily at 6:15 AM New York: https://claude.ai/code/routines/trig_019NHKog7ux3LF4JJ5azuktm |
| Setup pull request | https://github.com/hudsonshack/The-Shack/pull/1 (branch `claude/autonomous-agent-team-setup-k424uv`) |
| Text dashboard | `shack/dashboard/DASHBOARD.md` on the `ops/state` branch |

## How it runs
- The routine reads `shack/hub/ROUTINE.md` → `shack/hub/DIRECTOR.md` once a day at 6:15 AM. It reads from `main` if `main` has `shack/hub/DIRECTOR.md`, otherwise from the setup branch. It writes state only to the `ops/state` branch, renders `shack/world/world.html` and republishes the world link.
- J.A.R.V.I.S. (hub, formerly Mayor Tock) skips agents whose feeds are empty, so quiet days cost little.
- Agents: Abbot Quill (school, 40%), Lumi (Angie's social, 35%), Grit Copperpot (money, 20%), Cap'n Twirl (Fidgetly, maintenance mode, 5%).
- Rules: agents never spend money or send DMs; emails to other people need Hudson's OK; private data stays in gitignored `shack/private/`; Hermes never gets bank details, grades or client contacts.
- Republishing the world by hand: render from `origin/ops/state` merged with the latest code (`python3 shack/scripts/render_dashboard.py`), read the world link, list its files, then publish `shack/world/publish/index.html` with `files` world.js and shack-data.js and without capabilities (that keeps the database). Same steps as DIRECTOR.md step 8.

## Accounts and feeds
| Feed | Status |
|---|---|
| Gmail | thehudsonshack@gmail.com is connected. buzzbanditt@gmail.com forwards all new mail to it (working since Oct 9) |
| M&T Bank | Alerts go to buzzbanditt, which forwards them. No alert emails seen yet: check that debit purchases, deposits, withdrawals/transfers and low balance (<$50) are on by Email for MyWay Banking (0504) |
| Google Classroom | Not connected (SETUP step 2: forward from the school account, if allowed) |
| Angie's | Free-trial client in Cold Spring, NY. Raw footage folder `135ES_1QnMHb6aOjy9dECt3H4fTubD3Jz`, finished folder `1vEAQUTHR-L5PeIcie_kZGFGNz65ZpZkc`. Raw is empty: upload the shoot clips and the next cycle auto-edits them (`shack/agents/social-ops/tools/studio.py`) |
| Metricool | Brand 7176689 has no networks yet. Connect Angie's Instagram, TikTok and Facebook. Posts are scheduled only after Hudson confirms the owner approved |
| Shopify | Fidgetly (fidgetlystore.myshopify.com) connected, read-only, maintenance mode. 12 zero-stock variants and some placeholder quantities need real counts |
| Hermes | Off. Needs an OpenRouter key in the environment (`OPENROUTER_API_KEY`) and `openrouter.ai` allowed (SETUP step 6) |

## Still needed from Hudson
1. M&T alerts switched on (above), then a small purchase to test.
2. Angie's footage in the Raw folder.
3. Angie's accounts in Metricool.
4. Answers: what kind of place Angie's is, its monthly retainer, and target amounts and dates for Invest, Car insurance and Apartment fund.
5. Merge PR #1 (squash merge keeps the old name out of `main`'s history).
6. Optional: Classroom forwarding, Hermes key, and asking GitHub Support to detach the fork (removes "forked from Chi-K1ng/Chi-King-J.A.R.V.I.S").

## Build status
- World v3 (Oct 14): docked **Today** column on the left (J.A.R.V.I.S.'s brief from `state/brief.json`, calendar from `state/calendar.json`, Hudson's own to-dos in the page db collection `todos` plus agent tasks, school, the social media business, money only on Saturdays), fixed camera (clicking an island zooms in; the status card hides while a panel is open), midnight blue-black space drawn at screen resolution, sharp-bilinear pixel scaling, J.A.R.V.I.S. hologram + holo-console on Clockspire, Neon Hollow stall = the social media business (`config.json → agents.social-ops.business.name`, placeholder "Social media business").
- The routine's schedule has to be changed to 6:15 AM by Hudson in the Routines page (an agent can't edit a routine it didn't create).
- World v2 (floating islands, readable UI, bigger animated characters, Chronicle, Hermes chip, quest board) is finished. All 49 review issues and the 3 follow-ups are fixed; zero console errors.
- Preview: `node shack/world/tools/preview.mjs --out /tmp/w.png [--sample] [--time ...] [--width 400 --height 800]`.
- Checks: `python3 shack/scripts/validate.py`.
