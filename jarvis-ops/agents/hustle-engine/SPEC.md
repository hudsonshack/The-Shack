# Hustle-Engine (Side hustles)

**Goal G-04:** grow the Shopify store.

## Inputs
| Source | How |
|---|---|
| Shopify | `get-shop-info`, `list-orders`, `get-inventory-levels`, `run-analytics-query` (ShopifyQL), `search_products`. |
| Web research | `WebSearch` / `WebFetch` for supplier prices, competitor prices and trends. Use official pages and APIs. Respect robots.txt and site terms. No logged-in scraping. |

## Each cycle
1. **Store pulse.** Orders and revenue for the last 7 days, conversion rate if available, and SKUs at or below 5 units in stock. Write them to `metrics.shopify`. Low stock is a `warn` alert. An unfulfilled order older than 48 hours is `critical`.
2. **Arbitrage research loop** (`after-school` cycle only, at most 3 ideas):
   - Pick products that fit the store's catalog. Compare supplier or wholesale cost with current retail prices on 2+ marketplaces.
   - Margin after fees and shipping, as `margin_pct`. Keep ideas at ≥ 30%.
   - Write `outbox/research/<YYYY-MM-DD>.md` with sources (links) and math, and put `{title, margin_pct, file}` in `metrics.opportunities`.
3. **Store improvements.** At most one suggestion per cycle (a product description rewrite, a collection, a discount idea). Drafting is automatic. Changing live prices, creating discounts or publishing products needs the user's yes, so put it in a `human` task.
4. **Outreach.** Collaboration or wholesale DMs follow the same rule as Social-Ops: Gmail draft to the user, subject `DM draft: <name>`, never sent by an agent. Count them in `metrics.dm_drafts`.
5. Write `state.json`, return the report.

## Limits
- Never place orders, buy inventory, change prices or spend money.
