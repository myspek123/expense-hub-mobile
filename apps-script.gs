// Expense Hub Mobile -- Apps Script Web App
// VERSION 1.20
// Paste this whole file into Extensions > Apps Script on the Google Sheet
// created for mobile capture. Deploy > Manage deployments > edit (pencil)
// > Version: New version > Deploy, so the URL you already pasted into the
// phone's Settings keeps working. Only use "New deployment" the first time.
//
// After redeploying, open the Web App URL directly in a browser (paste the
// same URL from the phone's Settings field into any browser address bar).
// The JSON response includes "version":"1.20" -- if it still says an older
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
// Amount | Currency | Description | PaidWith | PhotoUrls | ReportRef |
// OcrStatus | OcrFields | OcrImageHash | OcrManualFields | ExpId | BaseValues |
// SyncToken | DeleteRequested | Consumed
// (ReportRef added 2026-08-01: which real PC report, if any, the phone
// picked from PCReports -- blank means free-typed, unfiled on the PC side.)
// (MobileEditToken added 2026-08-17: one token per phone edit, so the phone
// does not call a Sheet write an acknowledged PC update.)
//
// (Consumed added 2026-08-18, with the fix that made it necessary.)
//
// A capture used to be matched by ExpId when the phone sent one and by
// LocalId otherwise. That is two different keys for one row. The first post
// of a capture carries a blank ExpId, so the row is appended with LocalId L
// and no ExpId. The PC imports it and assigns EXP-000060. The phone learns
// that id, the user edits the capture, and the phone posts again -- this
// time WITH expId. findRowByExpId then searches a column where every value
// is still blank, finds nothing, and appends a SECOND row for the same
// LocalId. Both rows export forever afterwards, one carrying the old values
// and one the new, so every PC pull applied one and raised a conflict on the
// other. That is the endless "updated=1 skipped=1" in mobile_pull.log on
// 17/08/2026, and it is why one EUR 34 capture became a second LTI line.
//
// LocalId is the phone's permanent row identity and is now matched FIRST.
// ExpId is only a fallback for a row whose LocalId the phone has forgotten.
// Consumed is set by the PC once it has fully taken a capture in; a consumed
// row stops being exported, so a finished capture leaves the conversation
// instead of being re-offered on every pull for ever. Any phone write clears
// it again, because a capture the user has just edited is not finished.
//
// Sheet columns (PCReports, row 1, exact order) -- new 2026-08-01:
// TYPE | NAME | STATUS | REPORT_REF | UPDATED_AT | EXPENSE_COUNT | TOTAL |
// MISSING_EUR_COUNT
// Written only by the PC's own expense_hub/mobile_push.py, delete-then-
// rewrite on every push (same pattern eh_mh_bridge.py uses for
// FromEH/EHLists). Never edited here by hand.
//
// Sheet columns (PCExpenses, row 1, exact order) -- new 2026-08-02:
// EXP_ID | REPORT_REF | DATE | CATEGORY | DESCRIPTION | PAID_WITH | AMOUNT |
// CURRENCY | HAS_RECEIPT | NDF | REJECTED | REJECTED_NOTE | LOCAL_ID |
// PC_TAKEN_AT | OCR_FIELDS | DELETED | RECEIPT_FILE | MOBILE_EDIT_CONFLICT |
// EUR_AMOUNT | EUR_ESTIMATED | MOBILE_EDIT_TOKEN | MOBILE_DELETE_ERROR |
// MOBILE_EDIT_RESOLUTION
// Written only by expense_hub/mobile_push.py, delete-then-rewrite on every
// push. Every Draft report's lines are sent so an older line cannot silently
// stay on the PC only. Never edited here by
// hand.

var VERSION = '1.20';
var SHEET_NAME = 'MobileCaptures';
var PC_REPORTS_SHEET_NAME = 'PCReports';
var PC_EXPENSES_SHEET_NAME = 'PCExpenses';
var DRIVE_FOLDER_NAME = 'Expense Hub Mobile Receipts';

function syncCode_() {
  return PropertiesService.getScriptProperties().getProperty('SYNC_CODE') || '';
}

function codeOk_(param) {
  var required = syncCode_();
  if (!required) return true; // not configured yet -- open, same as pre-1.4
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
    if (data.action === 'push_expenses') {
      return doPushExpenses_(data);
    }
    if (data.action === 'ack_captures') {
      return doAckCaptures_(data);
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
      data.reportRef || '',
      data.ocrStatus || '',
      Array.isArray(data.ocrFields) ? data.ocrFields.join(',') : (data.ocrFields || ''),
      data.ocrImageHash || '',
      Array.isArray(data.ocrManualFields) ? data.ocrManualFields.join(',') : (data.ocrManualFields || ''),
      data.expId || '',
      data.baseValues ? JSON.stringify(data.baseValues) : '',
      data.syncToken || '',
      data.deleteRequested ? 1 : 0,
      // A phone write is by definition unfinished work: whatever the PC had
      // already acknowledged, this row now says something new.
      0
    ];

    // A phone can re-send a localId it already sent once, either as a
    // retried sync (dropped response) or because the user opened it from
    // the Queue and changed something -- either way, the sheet must end
    // up with ONE row that matches what the phone last saved.
    //
    // LocalId first. It is the phone's permanent identity for the row and it
    // is present on every post. ExpId is only consulted when the LocalId is
    // genuinely absent from the sheet, which happens when a phone was reset
    // and rebuilt its queue from PCExpenses. Matching on ExpId first is what
    // appended a duplicate row for a capture that already had one -- see the
    // header note.
    var existingRow = findRowByLocalId(sheet, data.localId, data.syncToken);
    if (!existingRow && data.expId) {
      existingRow = findRowByExpId(sheet, data.expId, data.syncToken);
    }
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
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).clearContent();
  }
  var rows = reports.map(function(r) {
    return [
      r.type || '', r.name || '', r.status || '', r.reportRef || '', r.updatedAt || '',
      r.expenseCount === undefined || r.expenseCount === null ? '' : r.expenseCount,
      r.total === undefined || r.total === null ? '' : r.total,
      r.missingEurCount === undefined || r.missingEurCount === null ? '' : r.missingEurCount
    ];
  });
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, 8).setValues(rows);
  }
  notePcCheckIn_();
  return respond({ ok: true, received: rows.length });
}

// WHEN THE PC LAST SPOKE TO THIS SHEET, recorded here rather than on any row.
//
// The phone had no way to tell a fresh answer from a stale one. "PC and phone
// agree" is read as "agreed just now", and it can just as easily mean the PC
// has not run since Tuesday. The 30 minute sync task is invisible: it runs
// pythonw.exe with no window, so nothing on either screen says whether it is
// alive (2026-08-23).
//
// This is a Script Property and not a Sheet column on purpose. It is one fact
// about the whole endpoint, not a fact about any report or expense, and it
// must not force a schema change on a sheet the PC rewrites wholesale.
function notePcCheckIn_() {
  try {
    PropertiesService.getScriptProperties()
      .setProperty('PC_LAST_SEEN', new Date().toISOString());
  } catch (err) {
    // Never fail a push over its own timestamp.
  }
}

function pcLastSeen_() {
  try {
    return PropertiesService.getScriptProperties().getProperty('PC_LAST_SEEN') || '';
  } catch (err) {
    return '';
  }
}

// Same delete-then-rewrite pattern as doPushReports_, one row per expense
// line within a Draft report's pushed 90-day window. The phone never edits
// this sheet, only reads it for the Reports tab's report-detail screen.
function doPushExpenses_(data) {
  var sheet = getOrCreatePCExpensesSheet();
  var expenses = data.expenses || [];
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 23).clearContent();
  }
  var rows = expenses.map(function(x) {
    return [
      x.expId || '', x.reportRef || '', x.date || '', x.category || '',
      x.description || '', x.paidWith || '', x.amount || '', x.currency || '',
      x.hasReceipt ? 1 : 0, x.ndf ? 1 : 0,
      x.rejected ? 1 : 0, x.rejectedNote || '', x.localId || '', x.pcTakenAt || '',
      Array.isArray(x.ocrFields) ? x.ocrFields.join(',') : (x.ocrFields || ''),
      x.deleted ? 1 : 0, x.receiptFile || '', x.mobileEditConflict || '',
      x.eurAmount === undefined || x.eurAmount === null ? '' : x.eurAmount,
      x.eurEstimated ? 1 : 0, x.mobileEditToken || '', x.mobileDeleteError || '',
      x.mobileEditResolution || ''
    ];
  });
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, 23).setValues(rows);
  }
  notePcCheckIn_();
  return respond({ ok: true, received: rows.length });
}

// The PC telling this sheet what it has finished with (2026-08-18).
//
// Two things happen per item, and they are deliberately NOT the same
// decision:
//
//   ExpId is written unconditionally. It is identity, the PC is the only
//   thing that can assign it, and a row that knows its own EXP_ID can never
//   again be mistaken for a new capture. This is the write-back whose absence
//   meant a MobileCaptures row stayed blank-ExpId for its whole life.
//
//   Consumed is written ONLY when the row's SyncToken still equals the token
//   the PC actually processed. If the user edited the capture on the phone
//   between the PC's read and this acknowledgement, the token has moved on,
//   and marking the row consumed would drop that edit on the floor for ever
//   -- the row would stop exporting and the PC would never see it. A
//   mismatched token simply leaves the row live for the next pull.
function doAckCaptures_(data) {
  var sheet = getOrCreateSheet();
  var items = data.captures || [];
  var acked = 0;
  var identified = 0;
  var deferred = 0;
  items.forEach(function(item) {
    var localId = item && item.localId;
    if (!localId) return;
    var rowNumber = findRowByLocalId(sheet, localId, item.syncToken);
    if (!rowNumber && item.expId) {
      rowNumber = findRowByExpId(sheet, item.expId, item.syncToken);
    }
    if (!rowNumber) return;
    if (item.expId) {
      sheet.getRange(rowNumber, 17).setValue(item.expId);
      identified += 1;
    }
    if (!item.consumed) return;
    var currentToken = String(sheet.getRange(rowNumber, 19).getValue() || '');
    var ackedToken = String(item.syncToken || '');
    if (currentToken !== ackedToken) {
      // The phone moved on. Leave it live so the next pull sees the new edit.
      deferred += 1;
      return;
    }
    sheet.getRange(rowNumber, 21).setValue(1);
    acked += 1;
  });
  return respond({ ok: true, acked: acked, identified: identified, deferred: deferred });
}

function doGet(e) {
  var code = e.parameter && e.parameter.code;
  if (!codeOk_(code)) {
    return respond({ ok: false, error: 'Invalid or missing sync code.' });
  }
  // pcLastSeen rides along on both reads so the phone can say how old the
  // answer is instead of implying it is live. See notePcCheckIn_.
  if (e.parameter && e.parameter.action === 'reports') {
    return respond({
      ok: true, version: VERSION, reports: listPCReports(), pcLastSeen: pcLastSeen_()
    });
  }
  if (e.parameter && e.parameter.action === 'expenses') {
    return respond({
      ok: true, version: VERSION, expenses: listPCExpenses(), pcLastSeen: pcLastSeen_()
    });
  }
  // Raw, ungrouped rows for the real PC Expense Hub app's pull-back job
  // (expense_hub/mobile_pull.py). Each photo is re-read from Drive and
  // returned as base64 so the PC never needs its own Google API credentials
  // -- same plain-HTTPS shape the phone already uses to post here.
  if (e.parameter && e.parameter.action === 'export') {
    return respond({ ok: true, version: VERSION, captures: exportCaptures() });
  }
  // A receipt captured on the PC, fetched on demand so the phone can look at
  // it (2026-08-16). The PC's data root lives inside the Google Drive folder,
  // so the file is already in Drive and this script runs as the same single
  // Google account -- nothing is shared, no link is published, and the phone
  // stores nothing. Asked for by file name, which Expense Hub makes unique
  // (EXP-000123_2026-04-22_Meals.jpg).
  if (e.parameter && e.parameter.action === 'receipt') {
    return respond(receiptByName_(e.parameter.name));
  }
  return respond({ ok: true, version: VERSION, message: 'Expense Hub Mobile sync endpoint is live.' });
}

// A plain "2026-07-31" string the phone posts gets auto-coerced by Sheets
// into a real Date-typed cell for the Date column (Timestamp already got
// this same treatment, which is why it already had a Date check -- Date
// never did, and that gap is exactly why some mobile captures were
// silently skipped on the PC side with "Expense date must use YYYY-MM-DD":
// row[4] was a Date object, JSON-serializing to a full ISO datetime, which
// Python's strict date parser rejects. Formatting in the SCRIPT's own
// timezone (not .toISOString(), which is always UTC and can roll the date
// back a day for timezones behind UTC) keeps the date exactly what was
// typed.
function formatDateCell_(value) {
  if (!(value instanceof Date)) return String(value || '');
  return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// How big a receipt this will hand back. A phone photo off the PC can be
// several megabytes, and base64 inflates it by a third; past that the request
// is slower than it is useful and Apps Script starts refusing to build the
// response at all. Answering "too big" is better than timing out.
var RECEIPT_MAX_BYTES = 8 * 1024 * 1024;

function receiptByName_(name) {
  name = String(name || '').trim();
  if (!name) return { ok: false, version: VERSION, error: 'No receipt name given.' };
  var files = DriveApp.getFilesByName(name);
  if (!files.hasNext()) {
    // Almost always means Drive has not finished syncing the PC's folder yet,
    // which is worth saying plainly rather than showing an empty frame.
    return {
      ok: false,
      version: VERSION,
      error: 'Not in Drive yet. It syncs from the PC, so try again shortly.'
    };
  }
  var file = files.next();
  if (file.getSize() > RECEIPT_MAX_BYTES) {
    return { ok: false, version: VERSION, error: 'That receipt is too large to open on the phone.' };
  }
  var blob = file.getBlob();
  return {
    ok: true,
    version: VERSION,
    name: file.getName(),
    mimeType: blob.getContentType(),
    dataBase64: Utilities.base64Encode(blob.getBytes())
  };
}

function exportCaptures() {
  var sheet = getOrCreateSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  // 21 columns. This reads the phone's own MobileCaptures sheet, which is a
  // different shape from PCExpenses -- the edit request fields are last.
  var values = sheet.getRange(2, 1, lastRow - 1, 21).getValues();
  var out = [];
  values.forEach(function(row) {
    var localId = row[1];
    if (!localId) return;
    // A capture the PC has fully taken in is finished. Leaving it in the
    // export meant every capture ever taken was re-offered on every pull for
    // ever, so one bad row could not settle: it was re-examined every few
    // minutes until something applied it again. Dropping it here also stops
    // this function re-encoding its photos as base64 on every single run,
    // which is most of why the export was timing out.
    if (row[20] === 1 || row[20] === true) return;
    out.push({
      timestamp: row[0] instanceof Date ? row[0].toISOString() : String(row[0]),
      localId: localId,
      reportType: row[2],
      reportName: row[3],
      date: formatDateCell_(row[4]),
      category: row[5],
      amount: row[6],
      currency: row[7],
      description: row[8],
      paidWith: row[9],
      photos: photoUrlsToBase64(row[10]),
      reportRef: row[11] || '',
      ocrStatus: row[12] || '',
      ocrFields: row[13] || '',
      ocrImageHash: row[14] || '',
      ocrManualFields: row[15] || '',
      expId: row[16] || '',
      baseValues: row[17] || '',
      syncToken: row[18] || '',
      deleteRequested: row[19] === 1 || row[19] === true,
      consumed: false
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
  var values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var out = [];
  values.forEach(function(row) {
    if (!row[3]) return;
    out.push({
      type: row[0], name: row[1], status: row[2], reportRef: row[3], updatedAt: row[4],
      expenseCount: row[5], total: row[6], missingEurCount: row[7]
    });
  });
  return out;
}

// PCExpenses rows, filtered to only what has an EXP_ID -- same defensive
// pattern as listPCReports().
function listPCExpenses() {
  var sheet = getOrCreatePCExpensesSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, 23).getValues();
  var out = [];
  values.forEach(function(row) {
    var isDeleted = row[15] === 1 || row[15] === true;
    // A deleted marker has no EXP_ID by definition -- the PC row is gone. It
    // is identified by its LOCAL_ID, so it must survive this filter.
    if (!row[0] && !(isDeleted && row[12])) return;
    out.push({
      expId: row[0], reportRef: row[1], date: formatDateCell_(row[2]),
      category: row[3], description: row[4], paidWith: row[5],
      amount: row[6], currency: row[7],
      hasReceipt: row[8] === 1 || row[8] === true,
      ndf: row[9] === 1 || row[9] === true,
      rejected: row[10] === 1 || row[10] === true,
      rejectedNote: row[11] || '', localId: row[12] || '', pcTakenAt: row[13] || '',
      ocrFields: row[14] || '',
      deleted: isDeleted,
      receiptFile: row[16] || '',
      mobileEditConflict: row[17] || '',
      eurAmount: row[18] || '',
      eurEstimated: row[19] === 1 || row[19] === true,
      mobileEditToken: row[20] || '',
      mobileDeleteError: row[21] || '',
      mobileEditResolution: row[22] || ''
    });
  });
  return out;
}

function getOrCreatePCExpensesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PC_EXPENSES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PC_EXPENSES_SHEET_NAME);
    sheet.appendRow([
      'EXP_ID', 'REPORT_REF', 'DATE', 'CATEGORY', 'DESCRIPTION', 'PAID_WITH',
      'AMOUNT', 'CURRENCY', 'HAS_RECEIPT', 'NDF', 'REJECTED', 'REJECTED_NOTE',
      'LOCAL_ID', 'PC_TAKEN_AT', 'OCR_FIELDS', 'DELETED', 'RECEIPT_FILE',
      'MOBILE_EDIT_CONFLICT', 'EUR_AMOUNT', 'EUR_ESTIMATED', 'MOBILE_EDIT_TOKEN',
      'MOBILE_DELETE_ERROR', 'MOBILE_EDIT_RESOLUTION'
    ]);
  } else if (String(sheet.getRange(1, 11).getValue()) !== 'REJECTED'
      || String(sheet.getRange(1, 15).getValue()) !== 'OCR_FIELDS'
      || String(sheet.getRange(1, 16).getValue()) !== 'DELETED'
      || String(sheet.getRange(1, 17).getValue()) !== 'RECEIPT_FILE'
      || String(sheet.getRange(1, 18).getValue()) !== 'MOBILE_EDIT_CONFLICT'
      || String(sheet.getRange(1, 19).getValue()) !== 'EUR_AMOUNT'
      || String(sheet.getRange(1, 20).getValue()) !== 'EUR_ESTIMATED'
       || String(sheet.getRange(1, 21).getValue()) !== 'MOBILE_EDIT_TOKEN'
       || String(sheet.getRange(1, 22).getValue()) !== 'MOBILE_DELETE_ERROR'
       || String(sheet.getRange(1, 23).getValue()) !== 'MOBILE_EDIT_RESOLUTION') {
    sheet.getRange(1, 1, 1, 23).setValues([[
      'EXP_ID', 'REPORT_REF', 'DATE', 'CATEGORY', 'DESCRIPTION', 'PAID_WITH',
      'AMOUNT', 'CURRENCY', 'HAS_RECEIPT', 'NDF', 'REJECTED', 'REJECTED_NOTE',
      'LOCAL_ID', 'PC_TAKEN_AT', 'OCR_FIELDS', 'DELETED', 'RECEIPT_FILE',
      'MOBILE_EDIT_CONFLICT', 'EUR_AMOUNT', 'EUR_ESTIMATED', 'MOBILE_EDIT_TOKEN',
      'MOBILE_DELETE_ERROR', 'MOBILE_EDIT_RESOLUTION'
    ]]);
  }
  return sheet;
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'Timestamp', 'LocalId', 'ReportType', 'ReportName', 'Date',
      'Category', 'Amount', 'Currency', 'Description', 'PaidWith', 'PhotoUrls', 'ReportRef',
      'OcrStatus', 'OcrFields', 'OcrImageHash', 'OcrManualFields', 'ExpId', 'BaseValues',
      'SyncToken', 'DeleteRequested', 'Consumed'
    ]);
    return sheet;
  }
  // Self-healing migration for a sheet created before the ReportRef column
  // existed -- same idempotent on-startup pattern as this app family's
  // other schema additions. Never touches existing rows.
  if (String(sheet.getRange(1, 12).getValue()) !== 'ReportRef') {
    sheet.getRange(1, 12).setValue('ReportRef');
  }
  sheet.getRange(1, 13, 1, 9).setValues([[
    'OcrStatus', 'OcrFields', 'OcrImageHash', 'OcrManualFields', 'ExpId', 'BaseValues',
    'SyncToken', 'DeleteRequested', 'Consumed'
  ]]);
  return sheet;
}

function getOrCreatePCReportsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PC_REPORTS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PC_REPORTS_SHEET_NAME);
    sheet.appendRow([
      'TYPE', 'NAME', 'STATUS', 'REPORT_REF', 'UPDATED_AT', 'EXPENSE_COUNT', 'TOTAL',
      'MISSING_EUR_COUNT'
    ]);
  } else if (String(sheet.getRange(1, 6).getValue()) !== 'EXPENSE_COUNT'
      || String(sheet.getRange(1, 7).getValue()) !== 'TOTAL'
      || String(sheet.getRange(1, 8).getValue()) !== 'MISSING_EUR_COUNT') {
    sheet.getRange(1, 1, 1, 8).setValues([[
      'TYPE', 'NAME', 'STATUS', 'REPORT_REF', 'UPDATED_AT', 'EXPENSE_COUNT', 'TOTAL',
      'MISSING_EUR_COUNT'
    ]]);
  }
  return sheet;
}

function findRowByLocalId(sheet, localId, syncToken) {
  if (!localId) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  // Read through Consumed. A LocalId can have an old consumed row and a
  // newer live row after the pre-1.18 duplicate-row bug. Prefer the exact
  // SyncToken the caller read; otherwise prefer a live row over the old
  // consumed one. Choosing the first LocalId was why the PC kept receiving
  // the EUR 34 row after every acknowledgement.
  var values = sheet.getRange(2, 2, lastRow - 1, 20).getValues();
  var liveRow = null;
  var fallbackRow = null;
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] !== localId) continue;
    var rowNumber = i + 2;
    if (syncToken && String(values[i][17] || '') === String(syncToken)) {
      return rowNumber;
    }
    if (!fallbackRow) fallbackRow = rowNumber;
    if (!values[i][19] && !liveRow) liveRow = rowNumber;
  }
  return liveRow || fallbackRow;
}

function findRowByExpId(sheet, expId, syncToken) {
  if (!expId) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  // Q:U is EXP_ID through Consumed: indices 0, 2 and 4 are the identity,
  // SyncToken and consumed flag respectively.
  var values = sheet.getRange(2, 17, lastRow - 1, 5).getValues();
  var liveRow = null;
  var fallbackRow = null;
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] !== expId) continue;
    var rowNumber = i + 2;
    if (syncToken && String(values[i][2] || '') === String(syncToken)) {
      return rowNumber;
    }
    if (!fallbackRow) fallbackRow = rowNumber;
    if (!values[i][4] && !liveRow) liveRow = rowNumber;
  }
  return liveRow || fallbackRow;
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
  if (obj && obj.version === undefined) obj.version = VERSION;
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
