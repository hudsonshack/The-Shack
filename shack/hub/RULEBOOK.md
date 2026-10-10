# Operational Rulebook

1. **Plan → verify → execute.** Every goal is split into tasks. Every task names its owner agent, a priority (1 = highest), an autonomy class and a `verify.check`. Nothing executes until its pre-checks pass. Nothing is `done` until its `verify.check` passes with evidence.
2. **Parallel spokes.** The four spokes run at the same time within a cycle. Their only shared state is `state/tasks.json`, and only the hub writes it.
3. **No cross-talk.** Spokes do not read or write each other's folders. The hub relays facts.
4. **Autonomy** (`config.json → autonomy`, profile `aggressive`):

   | Action | Rule |
   |---|---|
   | Read email, calendar, Drive, Metricool, Shopify | auto |
   | Draft (Gmail drafts, Quizlet import files, DM drafts, captions) | auto |
   | Commit and push state to `ops/state` | auto |
   | Create or move Google Calendar study blocks | auto |
   | Schedule client posts in Metricool | auto |
   | Send an email to another person | ask: leave a draft, block the task "awaiting approval" |
   | Send Instagram or Facebook DMs | never: drafts only, the user sends them |
   | Spend money, place orders, change prices, move funds | never |

5. **Privacy.**
   - Raw emails, transactions, grades, client contact details and DM drafts that name real people go in `shack/private/<agent>/`. It is gitignored and never committed.
   - Committed state holds totals, counts, titles and dates only. No account numbers, no full transaction lists, no passwords or tokens. `scripts/validate.py` blocks the common patterns.
   - Cloud cycles run in a fresh container each time, so `private/` is scratch space that starts empty every cycle. The lasting sources of truth are Gmail, Google Calendar, Metricool, Shopify and the committed summaries. Spokes rebuild totals from those sources each cycle (for example, month-to-date spending is recomputed from all of this month's M&T alert emails), which also makes every cycle safe to re-run.
   - The world page is private to the user's Claude account. Keep it to summaries all the same.
6. **Output style.** Dense tables and short lines. No conversational filler in reports.
7. **Failure handling.** A failing spoke never stops the cycle. Mark it `error`, add an alert, finish the others, log the cycle as `partial`.
8. **Asking the user.** Questions go in a task with `autonomy: "human"` and a clear title. They show on the town-square quest board under "Your tasks", where the user can tick them off.
