# One-time setup (about 10 minutes)

After these steps, everything runs by itself three times a day.

## 1. Give the Routine its repo and connectors
The hub runs as a Claude Routine named **The Shack: Director cycle** (05:45, 15:45 and 20:45 New York time). A Routine created from a chat can't carry connectors, so add them once:

1. Open claude.ai → **Code** → **Routines** (or the Routines list in the Claude app) → **The Shack: Director cycle** → edit.
2. Add the repository `hudsonshack/The-Shack`.
3. Add the connectors **Gmail**, **Google Calendar**, **Google Drive**, **Shopify** and **Metricool**.
4. Save. Optional: use **Run now** to test it.

Until this is done, cycles still run, but they mark every task that needs a connector as blocked.

Then merge the setup pull request on GitHub. Cycles read the system from `main` (falling back to the setup branch until it's merged) and write their updates to the `ops/state` branch.

## 2. Forward Google Classroom emails (Academic-Core)
Your school blocks Claude from opening Google Classroom, but Classroom emails you about every new assignment and due date. Forwarding those emails to your personal Gmail lets Academic-Core read them.

1. Open your **school** Gmail on a computer → ⚙️ → **See all settings** → **Forwarding and POP/IMAP**.
2. Click **Add a forwarding address** and enter your personal Gmail. Google sends a confirmation code there. Enter it.
   - **If that button is missing or greyed out**, your school blocks forwarding. Tell Claude, and it will switch to the next option.
3. Don't turn on forwarding for everything. Go to the **Filters and Blocked Addresses** tab → **Create a new filter**:
   - **From:** `classroom.google.com`
   - **Create filter** → check **Forward it to:** your personal Gmail → **Create filter**.
4. In Classroom (school account) → ⚙️ **Settings** → make sure email notifications are **on** for new work, due-date reminders and returned work.

Check: in the world, click the Highland Monastery. Its Classroom feed reads `connected` after the next cycle.

## 3. Turn on M&T Bank alerts (Ledger-Fi), whenever you're ready
Your paycheck already direct-deposits every Friday. These alerts let Grit Copperpot see it, along with every purchase, as emails. You don't need to download CSVs or share bank passwords. Ask Claude to walk you through it live if you'd rather.

1. M&T mobile app → **Menu** → **Alerts** (or in online banking: **Profile & Settings → Alerts**).
2. Turn on, with delivery by **email** to your personal Gmail:
   - Debit card / purchase alert with an amount of **$0.01** or more (so every purchase sends one)
   - Deposit alert (paychecks and tip deposits)
   - Withdrawal / transfer alert
   - Low balance alert (pick an amount, for example $50)

Check: in the world, click Copperpot Mine. Its bank feed reads `connected` after the next cycle.

## 4. Optional: git hooks on your MacBook
Only needed if you also edit this repo on your Mac. Install Git (`xcode-select --install`) if you haven't.

```sh
git clone https://github.com/hudsonshack/The-Shack.git
cd The-Shack
sh shack/scripts/install-hooks.sh
```

The hooks check state files and block secrets before every commit. They also re-render the dashboard and the world page, and auto-push commits made on `ops/state`.

## 5. Tell Claude a few numbers when you have them
These show as **your tasks** on the town-square quest board, where you can tick them off:
- Savings targets and deadlines for Invest, Car insurance and Apartment fund
- Angie's monthly retainer
