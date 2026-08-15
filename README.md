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

## PC pull-back and report push -- built 2026-08-01

`apps-script.gs` exposes `?action=export`, which the real Expense Hub app's
`expense_hub/mobile_pull.py` (in the `expense-hub` repo) reads to pull
captures in as real expenses. The other direction, `expense_hub/mobile_push.py`,
pushes the PC's own real report list up into a "PCReports" tab in this same
Sheet, which is what the phone's Reports tab and Add Expense report picker
actually show. Both run automatically every 30 minutes
(`python -m expense_hub.mobile_sync_all`, registered via
`register_mobile_pull.ps1` in the `expense-hub` repo) -- can still be run by
hand any time. Full detail and the design reasoning live in those modules'
docstrings and in `wiki/open_loops/expense-hub.md`.

**Whenever you paste an updated `apps-script.gs` into the Apps Script
editor, bump the `VERSION` constant at the top of the file and redeploy via
Manage deployments -> New version.** Opening the Web App URL directly in a
browser shows `"version":"..."` in the JSON response -- that is how you
confirm a redeploy actually took, without guessing.

The current file is version **1.9**. It adds `OCR_FIELDS` to the `PCExpenses`
tab. You do not need to add that column by hand: the script adds or repairs
the header when the next PC push runs. To activate it exactly:

1. Open the existing Apps Script project attached to the mobile Sheet.
2. Replace all code with the current `apps-script.gs` from this repo.
3. Click **Save**.
4. Click **Deploy -> Manage deployments**.
5. Click the pencil icon for the existing Web app deployment.
6. Set **Version** to **New version** and click **Deploy**.
7. Open the Web app URL in a browser. Confirm the JSON contains
   `"version":"1.9"`.

If the PC ever has a capture that remains in the pull output under `Skipped`,
the PC keeps a small diagnostic ledger at
`<EXPENSE_HUB_ROOT>/_mobile_sync/skipped.json`. Successful imports remove
their own entries. To deliberately empty that ledger later, run this exact
command from the `expense-hub` folder:

```powershell
python -m expense_hub.mobile_pull --clear-skipped
```

That clears only the diagnostic ledger; it does not delete phone captures,
receipts, expenses, reports, or rows from Google Sheets.

## Securing the endpoint -- v1.3, 2026-08-01

Only Yaron's and Ella's phones are meant to ever use this. To lock it down:

1. In the Apps Script editor: Project Settings (gear icon) -> Script
   Properties -> Add script property -> name `SYNC_CODE`, value: any code
   only the two of you will type. Save, then redeploy (Manage deployments ->
   New version).
2. On each phone: Settings tab -> "Sync code" field -> paste that same code
   -> Save.
3. On the PC (`expense-hub` repo): set the `EXPENSE_HUB_MOBILE_SYNC_CODE`
   environment variable, or add the code as a second line in
   `expense_hub/credentials/mobile_sync_url.txt` (the same gitignored file
   that already holds the sync URL on its first line).

Leaving `SYNC_CODE` unset keeps the endpoint exactly as open as it was
before v1.3 -- nothing breaks if you don't do this today, but every request
(phone capture, phone reports fetch, PC pull, PC push) is rejected once it
is set unless it carries the matching code.
