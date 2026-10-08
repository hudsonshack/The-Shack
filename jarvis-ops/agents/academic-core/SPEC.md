# Academic-Core (School)

**Goal G-01:** never miss a Google Classroom deadline, and study ahead of every test.

## Inputs
| Source | How |
|---|---|
| Google Classroom | The school blocks direct access. Classroom notification emails are auto-forwarded from the school Gmail to the personal Gmail. Search Gmail with `config.json → agents.academic-core.sources.gmail_query`. Forwarded messages look like "Fwd: New assignment: …" or "Due tomorrow: …". |
| Google Calendar | Read existing events so study blocks don't collide with work shifts or other plans. |
| Google Drive | Optional: class notes or slides the user saves there, used as material for test prep. |

If the Gmail search returns no Classroom emails at all, set `metrics.classroom_feed` to `"not connected"` and add a `warn` alert telling the user to finish SETUP.md step 2. Do not invent deadlines.

## Each cycle
1. **Deadlines.** Parse every Classroom email from the last 14 days into `{course, title, due (ISO date or datetime), type: assignment|quiz|test|project, source_subject}`. Drop duplicates (same course + title). Drop items the email says were turned in or graded. Keep the next 14 days in `metrics.deadlines`, soonest first.
2. **Alerts.** Due within 48 hours and not turned in → `warn`. Test or quiz within 72 hours → `warn`. Overdue → `critical`.
3. **Study blocks** (calendar-write is automatic):
   - For each test or quiz: put review blocks on Google Calendar at the spaced-repetition offsets in `config.json` counted **backwards** from the test date (the day before, 3 days before, 7, 14, 30), skipping offsets already in the past.
   - For each assignment: one work block before the due date, sized to the task (max `max_block_minutes`).
   - Only between `no_study_before` and `no_study_after` on weekdays, and not over existing events (including work shifts).
   - Title format: `📚 <Course>: <topic>`. Put `jarvis-ops:academic-core` in the event description so later cycles can find and move their own events. Never edit events without that marker.
   - Record created blocks in `metrics.study_blocks` (next 7 days).
4. **Test prep.** For every test or quiz within 10 days, build a Quizlet set:
   - Write `outbox/quizlet/<YYYY-MM-DD>-<course>-<topic>.txt`: one card per line, `term<TAB>definition`, 20–40 cards, from the Classroom email text, Drive notes on that course, and standard high-school curriculum for the topic.
   - At the top of the same folder keep `README.md` with import steps: Quizlet → Create → Import → paste → "Between term and definition: Tab", "Between cards: New line". After import, Quizlet's **Test** mode makes the practice exam.
   - Add the set to `metrics.prep_sets` as `{title, cards, file}`.
5. Write `state.json` (`phase: "idle"`, `last_run`, a one-line `summary`, `alerts`, `metrics`), then return the report.

## Limits
- Read-only on the school account; it is never accessed directly.
- Grades and teacher comments stay out of committed files.
