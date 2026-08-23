# Expense Hub receipt OCR proxy: exact setup and test runbook

This is a new, standalone Google Apps Script project. It is separate from the
mobile sync script in `../apps-script.gs` and does not read or write the mobile
Sheet.

There are three things to configure:

1. The new OCR Apps Script project.
2. The existing mobile sync Apps Script redeployment.
3. The PC and phone settings that point to the OCR Web App.

Do these in order. Do not paste API keys or shared tokens into GitHub, chat, or
this repository.

## 1. Create the OCR Apps Script project

1. Sign in to the Google account that owns the Expense Hub mobile Sheet.
2. Open [Google Apps Script](https://script.google.com/).
3. Click **New project**.
4. Rename the project to `Expense Hub OCR Proxy` by clicking **Untitled project**.
5. In the left file list, open the default `Code.gs` file.
6. Select everything in that file and delete it.
7. On this PC, open the source file below:

   `C:\Users\2simp\expense-hub-mobile\gas_ocr\ocr_proxy.gs`

8. Copy the entire file and paste it into `Code.gs`.
9. Rename `Code.gs` to `ocr_proxy.gs` using the file's three-dot menu and
   **Rename**.
10. Click **Project Settings** (the gear icon on the left).
11. Turn on **Show "appsscript.json" manifest file in editor**.
12. Open `appsscript.json` in the left file list.
13. Replace its complete contents with this exact manifest:

```json
{
  "timeZone": "Europe/Paris",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file"
  ]
}
```

The two spreadsheet scopes were added on 2026-08-23. They exist so this script
can keep its own scan cost log, described in section 5 below. `drive.file`
grants access only to files this script itself creates, not to the rest of
Drive.

14. Press **Ctrl+S** or click **Save project**.

## 2. Create the two Script Properties

1. In the OCR project, click **Project Settings**.
2. Scroll to **Script Properties**.
3. Click **Add script property**.
4. Enter this property name exactly:

   `GEMINI_API_KEY`

5. Paste the Gemini API key into the value box and click **Save script
   properties**.
6. Click **Add script property** again.
7. Enter this property name exactly:

   `OCR_SHARED_TOKEN`

8. Create a private shared token. One Windows PowerShell way is:

```powershell
([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
```

9. Copy the generated token into the value box and click **Save script
   properties**.
10. Keep the token in a password manager or another private location. You will
    enter the same token once in the PC and once in the phone settings.

If a Gemini API key is not already available, create one in [Google AI
Studio](https://aistudio.google.com/apikey). Use the key value only in the
`GEMINI_API_KEY` property. Never put it in `ocr_proxy.gs`.

## 3. Deploy the new OCR Web App

1. In the OCR Apps Script project, click **Deploy** in the top right.
2. Click **New deployment**.
3. For **Select type**, click the gear icon and choose **Web app**.
4. Set **Description** to `Expense Hub OCR proxy 1.0`.
5. Set **Execute as** to **Me**.
6. Set **Who has access** to **Anyone**. This is required because the PC and
   phone send the shared token themselves. Do not choose **Anyone within** an
   organization unless both clients are guaranteed to be inside that
   organization.
7. Click **Deploy**.
8. Complete Google's authorization dialog:
   - choose the correct Google account;
   - click **Advanced** if Google shows an unverified-app warning;
   - click **Go to Expense Hub OCR Proxy**;
   - click **Allow**.
9. Copy the **Web app URL**. It must end in `/exec`, not `/dev`.
10. Keep this URL private. It is not sufficient by itself to authorize a
    request; the shared token is also required.

## 4. Test the new OCR Web App before configuring the apps

Run this in Windows PowerShell. Replace only the receipt filename if needed.
The command reads the token from the local PC credential file in the next
step, so do not paste the token into the command itself.

1. Create the PC credential file first by following Section 5.
2. Confirm the file contains the deployed `/exec` URL and token.
3. Run:

```powershell
$config = Get-Content -LiteralPath 'C:\Users\2simp\expense-hub\expense_hub\credentials\ocr_proxy.json' | ConvertFrom-Json
$receipt = 'C:\Users\2simp\expense-hub-acceptance-data\ocr_test_receipts\WhatsApp Image 2026-08-15 at 01.13.12 (1).jpeg'
$image = [Convert]::ToBase64String([IO.File]::ReadAllBytes($receipt))
$body = @{
  version = '1.0'
  token = $config.token
  requestId = 'manual-setup-test'
  mimeType = 'image/jpeg'
  image = $image
  categories = @('Meals and Entertainment', 'Travel Expense', 'Office Supplies')
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri $config.url -Method Post -ContentType 'application/json' -Body $body
```

4. A successful response must contain:
   - `ok: true`;
   - `model: "gemini-2.5-pro"`;
   - a date, amount, currency, and category field;
   - a `confidence` object.
5. If the response contains `ok: false`, use the error table in Section 9.

## 5. Configure the desktop PC

The PC client reads a gitignored JSON file. This is the recommended setup.

1. Open Windows PowerShell.
2. Run:

```powershell
New-Item -ItemType Directory -Force 'C:\Users\2simp\expense-hub\expense_hub\credentials'
notepad 'C:\Users\2simp\expense-hub\expense_hub\credentials\ocr_proxy.json'
```

3. Paste this JSON, replacing the two placeholder values:

```json
{
  "url": "PASTE_THE_NEW_APPS_SCRIPT_EXEC_URL_HERE",
  "token": "PASTE_THE_EXACT_OCR_SHARED_TOKEN_HERE"
}
```

4. Save the file as `ocr_proxy.json`, not `ocr_proxy.json.txt`.
5. Close Notepad.
6. Verify that the file is not tracked by Git:

```powershell
git -C 'C:\Users\2simp\expense-hub' status --short -- 'expense_hub/credentials/ocr_proxy.json'
```

The command should print nothing. If it prints the file, stop and do not
commit it.

The alternative is to set these environment variables for the process that
runs Expense Hub:

```powershell
$env:EXPENSE_HUB_OCR_URL = 'PASTE_THE_NEW_APPS_SCRIPT_EXEC_URL_HERE'
$env:EXPENSE_HUB_OCR_TOKEN = 'PASTE_THE_EXACT_OCR_SHARED_TOKEN_HERE'
```

The JSON file is easier for the normal desktop installation because it remains
available after opening a new terminal.

## 6. Configure the phone

1. Open the Expense Hub mobile page.
2. Open the **Settings** tab.
3. In **Receipt scan URL**, paste the new Apps Script `/exec` URL.
4. In **Receipt scan token**, paste the exact same value used for
   `OCR_SHARED_TOKEN`.
5. Confirm the normal **Sync URL** and sync code are still present. These are
   the existing mobile sync settings and are different from the scan URL and
   scan token.
6. Click **Save settings**.
7. Return to **Add expense**.

The scan URL and scan token are stored in the phone browser's local storage.
They are not written into the mobile sync Sheet.

## 7. Redeploy the existing mobile sync script

The OCR metadata columns are part of the existing mobile sync script. This is
not the new OCR proxy project.

1. Open the existing Apps Script project bound to the Expense Hub mobile
   Sheet.
2. Open the existing script source.
3. On this PC, open:

   `C:\Users\2simp\expense-hub-mobile\apps-script.gs`

4. Copy the entire file and replace the existing Apps Script source with it.
5. Save the project.
6. Click **Deploy** -> **Manage deployments**.
7. Click the pencil/edit icon for the existing Web App deployment.
8. Set **Version** to **New version**.
9. Click **Deploy**. Keep the existing deployment URL.
10. Open the existing mobile sync URL in a browser. The response must contain
    `"version":"1.8"`.

Do not create a second mobile sync deployment. The new OCR proxy is the only
separate project.

## 8. End-to-end application test

1. Start or open the desktop Expense Hub application.
2. Add a new expense.
3. Attach this supplied receipt:

   `C:\Users\2simp\expense-hub-acceptance-data\ocr_test_receipts\WhatsApp Image 2026-08-15 at 01.13.12 (1).jpeg`

4. Leave Amount and Date blank and save.
5. Immediately after saving, the row may show the amber **Scan pending** chip.
6. Wait for the scan to finish. The date, amount, currency, and category may
   be filled only when they were blank and the result is medium or high
   confidence.
7. Type a value into Amount while a scan is pending. Save it. That typed
   value must remain unchanged when the scan finishes.
8. To test retry, stop or misconfigure the proxy, save a receipt, confirm the
   amber **Scan failed, retry** state, correct the configuration, and click
   retry.

## 9. Error lookup

| Response | Meaning | Fix |
|---|---|---|
| `bad_token` | PC/phone token differs from `OCR_SHARED_TOKEN` | Copy the same token to all three places and save again. |
| `no_key` | `GEMINI_API_KEY` is missing or invalid | Add or replace that Script Property, then deploy a new version. |
| `bad_image` | The upload is not a readable supported image | Use a JPEG, PNG, or WebP receipt image. |
| `too_large` | Image exceeds the proxy limit | Use a smaller image. |
| `rate_limited` or `overloaded` | Gemini is temporarily busy | Click retry later. |
| `blocked` | Gemini blocked the image response | Use a clear receipt photo without unrelated content. |
| `unknown` | Request, deployment, or response problem | Confirm the URL ends in `/exec`, redeploy, and repeat Section 4. |

If the phone says **Scan pending** forever, open Settings and verify the scan
URL and token, confirm the phone is online, click **Save settings**, and click
the amber retry control in Queue.

## 10. Actual handset verification

The local browser harness already tested the queue mechanism. These three items
still require the real handset:

1. Capture a receipt with the real camera.
2. Capture during a real mid-trip network drop, reconnect, and confirm the
   queued scan completes.
3. Confirm the amber scan chip clears on the real handset.

The deployment and Script Property steps above are intentionally manual because
they require access to the user's Google account.

## 11. The scan cost log (added 2026-08-23)

Every billed scan passes through this script, from the phone and from the PC
alike, so this script logs them all.

Before this, scans were counted only on the PC, in
`_ocr_costs.csv` beside the workbook. A scan run from the handset was billed to
the same Gemini key and was written down nowhere, so the visible total was
always lower than the amount actually charged, with no way to tell by how much.

**Where the log is.** The first scan after this version is deployed creates a
new spreadsheet in the owning Google account called **Expense Hub receipt scan
costs**, and remembers its id in a Script Property named `COST_SHEET_ID`. To
get its address, open the Apps Script editor, choose `showCostSheetUrl` in the
function dropdown, click **Run**, and read the URL from the execution log. The
URL is deliberately not served over the web.

**What each row holds.**

| Column | Meaning |
|---|---|
| `When` | Time of the call |
| `Source` | `phone` or `pc` |
| `RequestId` | Ties the row back to a capture |
| `Model` | Which Gemini model answered |
| `Outcome` | `ok`, or the failure code |
| `InputTokens` / `OutputTokens` / `ThinkingTokens` / `TotalTokens` | As reported by Google |
| `USD` | Estimated cost of that one call |

**Failed calls are logged too, with zero tokens and zero cost.** That is on
purpose. A phone scan that fails with "Failed to fetch" may have died before
Google was ever asked, or after Google had already answered and been paid. A
row here with an `Outcome` other than `ok` and a nonzero token count is the
second case. Without this there was no way to tell them apart.

**The prices are hardcoded and will go stale.** They live in `OCR_PRICES` at
the top of `ocr_proxy.gs`, and are duplicated in
`C:\Users\2simp\expense-hub\expense_hub\ocr_cost.py`. Correct both together.

**`_ocr_costs.csv` still exists and still records PC scans only.** It is not
the whole picture and is no longer the place to look for a monthly total. Use
the spreadsheet.
