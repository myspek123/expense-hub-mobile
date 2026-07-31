# Expense Hub Mobile

Offline-first phone capture page for Expense Hub. Lives at:
https://myspek123.github.io/expense-hub-mobile/

Works from anywhere, no WiFi/PC dependency. Captures queue on the phone
(localStorage) and sync to a Google Sheet whenever the phone has any signal.

## One-time setup (yours to do, three steps, Google requires the human click)

1. Go to [sheets.google.com](https://sheets.google.com), create a new blank sheet,
   name it "Expense Hub Mobile".
2. In that sheet: Extensions -> Apps Script. Delete the placeholder code, paste
   in the contents of `apps-script.gs` from this repo. Save.
3. Click Deploy -> New deployment -> gear icon -> Web app.
   Execute as: **Me**. Who has access: **Anyone**. Click Deploy, then
   **Authorize access** (this is the one click only you can do -- it's Google
   confirming the script may write to your own Drive/Sheet, tied to your
   account). Copy the Web app URL it gives you.

Paste that URL into the mobile page itself: open the site on your phone,
tap Settings, paste the URL, tap Save. Done, one time, per phone.

## What happens after that

Every expense captured on the phone lands as a row in the "MobileCaptures"
tab of that Sheet, with any photo saved into a "Expense Hub Mobile Receipts"
Drive folder and linked from the row.

## PC pull-back -- built 2026-08-01

`apps-script.gs` (v1.2+) exposes `?action=export`, which the real Expense
Hub app's `expense_hub/mobile_pull.py` (in the `expense-hub` repo) reads to
pull captures in as real Unfiled expenses, run by hand
(`python -m expense_hub.mobile_pull`), never on a schedule. Full detail and
the design reasoning live in that module's docstring and in
`wiki/open_loops/expense-hub.md`.

**Whenever you paste an updated `apps-script.gs` into the Apps Script
editor, bump the `VERSION` constant at the top of the file and redeploy via
Manage deployments -> New version.** Opening the Web App URL directly in a
browser shows `"version":"..."` in the JSON response -- that is how you
confirm a redeploy actually took, without guessing.
