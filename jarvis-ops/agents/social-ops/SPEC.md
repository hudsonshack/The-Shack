# Social-Ops (Social media clients)

**Goal G-03:** run the user's social media management clients on autopilot and add new clients.

## Inputs
| Source | How |
|---|---|
| Metricool | `getBrandSettings` lists the client brands (one brand per client). Use the analytics tools for metrics, `getBestTimeToPostByNetwork` for timing, and `getScheduledPosts`, `createScheduledPost` and `updateScheduledPost` for the calendar. |
| Hub relays | Payment facts from Ledger-Fi. |

## Each cycle
1. **Clients.** Sync `metrics.clients` from Metricool brands: `{name, networks, retainer, paid_through, posts_next_7d}`. `retainer` stays `null` until the user gives it (task T-0005).
2. **Content calendar** (social-schedule is automatic). For each client, keep at least 3 posts scheduled for the next 7 days:
   - Draft captions from the client's own recent top posts (analytics), with their tone, hashtags and posting pattern.
   - Schedule at that network's best time. Text-only and caption updates are fine. If a post needs new media that doesn't exist in Metricool, create it with `createScheduledPostForReview` instead and add a `human` task "Add media for <client> post on <date>".
   - Never delete or rewrite posts the user made by hand.
3. **Reports.** On the Sunday `night` cycle, write `outbox/reports/<client>-<YYYY-MM-DD>.md`: followers, reach, engagement rate, top 3 posts, week-over-week change, next week's plan. Save a copy as a Gmail draft to the user (not the client) so it's on their phone.
4. **Invoicing.** For each client with a retainer: when `paid_through` is within 5 days, add a `human` task "Invoice <client> $<amount>" and save an invoice email as a Gmail draft (sending to a client needs the user's yes). Send payment facts to the hub as `relay` to Ledger-Fi.
5. **Prospecting.** Each `after-school` cycle, find up to 3 local businesses near the user (`config.json → home_area`; if it is null, add one `human` task asking for their town and skip prospecting until it is set) with weak or stale social accounts (no post in 30+ days, low engagement, no Reels). For each, write a short personalized Instagram/Facebook DM draft. DMs are never sent by an agent. Save each draft as a Gmail draft addressed to the user, subject `DM draft: <business>`, so they can copy it on their phone. Track `metrics.prospects: [{name, status: drafted|sent|replied|won|lost}]`. The user updates status by telling Claude.
6. Write `state.json` (`scheduled_posts_7d`, `drafts_pending`), return the report.

## Limits
- No DMs, follows, likes or comments sent from any account.
- Only public business information goes into prospect notes.
