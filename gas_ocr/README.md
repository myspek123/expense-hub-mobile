# Expense Hub receipt OCR proxy

This is a separate Apps Script project from the mobile sync script in
`../apps-script.gs`. It does not read or write the sync Sheet. The PC and
phone send the same wire contract here, and this project calls Gemini with
the key stored in Script Properties.

## Manual deployment

1. Create a new standalone Apps Script project in the Google account that owns
   the Expense Hub mobile Sheet.
2. Replace its `appsscript.json` with this folder's manifest and add
   `ocr_proxy.gs` as the script source.
3. In Project Settings -> Script Properties, add these properties by name:
   `GEMINI_API_KEY` and `OCR_SHARED_TOKEN`.
4. Deploy -> New deployment -> Web app. Execute as **Me** and allow access to
   **Anyone**. Authorize the deployment and copy its Web App URL.
5. Put that URL and the same shared token in the PC's gitignored
   `expense_hub/credentials/ocr_proxy.json`, using this shape:

   ```json
   {"url":"https://script.google.com/macros/s/.../exec","token":"..."}
   ```

   The PC may use `EXPENSE_HUB_OCR_URL` and `EXPENSE_HUB_OCR_TOKEN` instead.

The deployment is deliberately not performed by this repository change: it
requires the user's Google account and the two Script Property values. Until it
exists, the PC client and all tests use a stubbed HTTP layer.
