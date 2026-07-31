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

## Not yet built

The PC's Expense Hub app does not pull from this Sheet yet -- captures land
in the Sheet and Drive but do not appear inside Expense Hub's own Reports
until that pull side is built (same shape as Invoice Hub's existing
`online_sync.py`).
