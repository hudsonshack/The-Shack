# One-time setup (about 10 minutes)

After these steps, everything runs by itself three times a day.

## 1. Give the Routine its repo and connectors
The hub runs as a Claude Routine named **J.A.R.V.I.S. Ops hub cycle** (05:46, 15:46 and 20:46 New York time). A Routine created from a chat can't carry connectors, so add them once:

1. Open claude.ai → **Code** → **Routines** (or the Routines list in the Claude app) → **J.A.R.V.I.S. Ops hub cycle** → edit.
2. Add the repository `hudsonshack/Chi-King-J.A.R.V.I.S`.
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

Check: the next cycle's dashboard shows `feed: connected` on Academic-Core.

## 3. Turn on M&T Bank alerts (Ledger-Fi)
Every purchase and deposit then shows up as an email that Ledger-Fi reads. You don't need to download CSVs or share bank passwords.

1. M&T mobile app → **Menu** → **Alerts** (or in online banking: **Profile & Settings → Alerts**).
2. Turn on, with delivery by **email** to your personal Gmail:
   - Debit card / purchase alert with an amount of **$0.01** or more (so every purchase sends one)
   - Deposit alert (paychecks and tip deposits)
   - Withdrawal / transfer alert
   - Low balance alert (pick an amount, for example $50)

Check: the next cycle's dashboard shows `feed: connected` on Ledger-Fi.

## 4. Optional: git hooks on your MacBook
Only needed if you also edit this repo on your Mac. Install Git (`xcode-select --install`) if you haven't.

```sh
git clone https://github.com/hudsonshack/Chi-King-J.A.R.V.I.S.git
cd Chi-King-J.A.R.V.I.S
sh jarvis-ops/scripts/install-hooks.sh
```

The hooks check state files and block secrets before every commit. They also re-render the dashboard and auto-push commits made on `ops/state`.

## 5. Tell Claude a few numbers when you have them
These show as **you** tasks on the dashboard:
- Savings targets and deadlines for Invest, Car insurance and Apartment fund
- Each social media client's monthly retainer
- Your town, so Social-Ops can find local businesses to pitch
