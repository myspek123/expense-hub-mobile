// Expense Hub Mobile -- Apps Script Web App
// VERSION 1.3
// Paste this whole file into Extensions > Apps Script on the Google Sheet
// created for mobile capture. Deploy > Manage deployments > edit (pencil)
// > Version: New version > Deploy, so the URL you already pasted into the
// phone's Settings keeps working. Only use "New deployment" the first time.
//
// After redeploying, open the Web App URL directly in a browser (paste the
// same URL from the phone's Settings field into any browser address bar).
// The JSON response includes "version":"1.3" -- if it still says an older
// number, the redeploy did not actually take and that is the bug, not the
// code below.
//
// SECURITY (2026-08-01): Project Settings > Script Properties > add
// SYNC_CODE = <a code only Yaron's and Ella's phones will ever type>. Once
// set, every request -- phone capture, phone Reports fetch, the PC's pull
// and push jobs -- must include that same value as `code` (a query param on
// GET, a field in the JSON body on POST) or it is rejected. Leaving
// SYNC_CODE unset keeps this endpoint exactly as open as it was before this
// version, so setting it up is never a breaking change forced on you --
// only do it when ready, then also paste the same code into each phone's
// Settings screen and into the PC's EXPENSE_HUB_MOBILE_SYNC_CODE env var
// (or the second line of expense_hub/credentials/mobile_sync_url.txt).
//
// Sheet columns (MobileCaptures, row 1, exact order):
// Timestamp | LocalId | ReportType | ReportName | Date | Category |
// Amount | Currency | Description | PaidWith | PhotoUrls | ReportRef
// (ReportRef added 2026-08-01: which real PC report, if any, the phone
// picked from PCReports -- blank means free-typed, unfiled on the PC side.)
//
// Sheet columns (PCReports, row 1, exact order) -- new 2026-08-01:
// TYPE | NAME | STATUS | REPORT_REF | UPDATED_AT
// Written only by the PC's own expense_hub/mobile_push.py, delete-then-
// rewrite on every push (same pattern eh_mh_bridge.py uses for
// FromEH/EHLists). Never edited here by hand.

var VERSION = '1.3';
var SHEET_NAME = 'MobileCaptures';
var PC_REPORTS_SHEET_NAME = 'PCReports';
var DRIVE_FOLDER_NAME = 'Expense Hub Mobile Receipts';

function syncCode_() {
  return PropertiesService.getScriptProperties().getProperty('SYNC_CODE') || '';
}

function codeOk_(param) {
  var required = syncCode_();
  if (!required) return true; // not configured yet -- open, same as pre-1.3
  return param === required;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var data = JSON.parse(e.postData.contents);
    if (!codeOk_(data.code)) {
      return respond({ ok: false, error: 'Invalid or missing sync code.' });
    }
    if (data.action === 'push_reports') {
      return doPushReports_(data);
    }

    var sheet = getOrCreateSheet();
    var photoUrls = savePhotos(data.photos);

    var row = [
      new Date(),
      data.localId || '',
      data.reportType || '',
      data.reportName || '',
      data.date || '',
      data.category || '',
      data.amount || '',
      data.currency || '',
      data.description || '',
      data.paidWith || '',
      photoUrls.join(', '),
      data.reportRef || ''
    ];

    // A phone can re-send a localId it already sent once, either as a
    // retried sync (dropped response) or because the user opened it from
    // the Queue and changed something -- either way, the sheet must end
    // up with one row that matches what the phone last saved, not a
    // silent no-op.
    var existingRow = findRowByLocalId(sheet, data.localId);
    if (existingRow) {
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
      return respond({ ok: true, updated: true });
    }

    sheet.appendRow(row);
    return respond({ ok: true, updated: false });
  } catch (err) {
    return respond({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Replaces PCReports' contents wholesale with what the PC just sent --
// delete-then-rewrite, so a report archived or renamed on the PC can never
// leave a stale row behind for the phone to still offer.
function doPushReports_(data) {
  var sheet = getOrCreatePCReportsSheet();
  var reports = data.reports || [];
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).clearContent();
  }
  var rows = reports.map(function(r) {
    return [r.type || '', r.name || '', r.status || '', r.reportRef || '', r.updatedAt || ''];
  });
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, 5).setValues(rows);
  }
  return respond({ ok: true, received: rows.length });
}

function doGet(e) {
  var code = e.parameter && e.parameter.code;
  if (!codeOk_(code)) {
    return respond({ ok: false, error: 'Invalid or missing sync code.' });
  }
  if (e.parameter && e.parameter.action === 'reports') {
    return respond({ ok: true, version: VERSION, reports: listPCReports() });
  }
  // Raw, ungrouped rows for the real PC Expense Hub app's pull-back job
  // (expense_hub/mobile_pull.py). Each photo is re-read from Drive and
  // returned as base64 so the PC never needs its own Google API credentials
  // -- same plain-HTTPS shape the phone already uses to post here.
  if (e.parameter && e.parameter.action === 'export') {
    return respond({ ok: true, version: VERSION, captures: exportCaptures() });
  }
  return respond({ ok: true, version: VERSION, message: 'Expense Hub Mobile sync endpoint is live.' });
}

function exportCaptures() {
  var sheet = getOrCreateSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  var out = [];
  values.forEach(function(row) {
    var localId = row[1];
    if (!localId) return;
    out.push({
      timestamp: row[0] instanceof Date ? row[0].toISOString() : String(row[0]),
      localId: localId,
      reportType: row[2],
      reportName: row[3],
      date: row[4],
      category: row[5],
      amount: row[6],
      currency: row[7],
      description: row[8],
      paidWith: row[9],
      photos: photoUrlsToBase64(row[10]),
      reportRef: row[11] || ''
    });
  });
  return out;
}

// Re-fetches each attached receipt from Drive and returns it as base64. A
// photo whose Drive file was moved or removed is skipped, not fatal -- the
// rest of that capture's fields still export.
function photoUrlsToBase64(urlsField) {
  if (!urlsField) return [];
  var urls = String(urlsField).split(',').map(function(u) { return u.trim(); }).filter(Boolean);
  var out = [];
  urls.forEach(function(url) {
    var m = url.match(/\/d\/([^/]+)/);
    if (!m) return;
    try {
      var file = DriveApp.getFileById(m[1]);
      var blob = file.getBlob();
      out.push({
        name: file.getName(),
        mimeType: blob.getContentType(),
        base64: Utilities.base64Encode(blob.getBytes())
      });
    } catch (err) {
      // file missing or no longer accessible -- skip this one photo only
    }
  });
  return out;
}

// PCReports rows, filtered to only what actually has a REPORT_REF -- a
// blank leftover row (there shouldn't be one, delete-then-rewrite leaves
// none, but a manual edit could add one) is never offered as a pick.
function listPCReports() {
  var sheet = getOrCreatePCReportsSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var out = [];
  values.forEach(function(row) {
    if (!row[3]) return;
    out.push({ type: row[0], name: row[1], status: row[2], reportRef: row[3], updatedAt: row[4] });
  });
  return out;
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'Timestamp', 'LocalId', 'ReportType', 'ReportName', 'Date',
      'Category', 'Amount', 'Currency', 'Description', 'PaidWith', 'PhotoUrls', 'ReportRef'
    ]);
    return sheet;
  }
  // Self-healing migration for a sheet created before the ReportRef column
  // existed -- same idempotent on-startup pattern as this app family's
  // other schema additions. Never touches existing rows.
  if (String(sheet.getRange(1, 12).getValue()) !== 'ReportRef') {
    sheet.getRange(1, 12).setValue('ReportRef');
  }
  return sheet;
}

function getOrCreatePCReportsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PC_REPORTS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PC_REPORTS_SHEET_NAME);
    sheet.appendRow(['TYPE', 'NAME', 'STATUS', 'REPORT_REF', 'UPDATED_AT']);
  }
  return sheet;
}

function findRowByLocalId(sheet, localId) {
  if (!localId) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var values = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === localId) return i + 2;
  }
  return null;
}

function savePhotos(photos) {
  if (!photos || !photos.length) return [];
  var folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);
  var urls = [];
  photos.forEach(function(p) {
    if (!p.base64 || !p.name) return;
    var parts = p.base64.split(',');
    var meta = parts[0];
    var raw = parts[1] || parts[0];
    var mime = (meta.match(/data:(.*);base64/) || [null, 'image/jpeg'])[1];
    var blob = Utilities.newBlob(Utilities.base64Decode(raw), mime, p.name);
    var file = folder.createFile(blob);
    urls.push(file.getUrl());
  });
  return urls;
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
