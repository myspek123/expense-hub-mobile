// Expense Hub Mobile -- Apps Script Web App
// Paste this whole file into Extensions > Apps Script on the Google Sheet
// created for mobile capture. Deploy > Manage deployments > edit (pencil)
// > Version: New version > Deploy, so the URL you already pasted into the
// phone's Settings keeps working. Only use "New deployment" the first time.
//
// Sheet columns (row 1, exact order):
// Timestamp | LocalId | ReportType | ReportName | Date | Category |
// Amount | Currency | Description | PaidWith | PhotoUrls

var SHEET_NAME = 'MobileCaptures';
var DRIVE_FOLDER_NAME = 'Expense Hub Mobile Receipts';

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var data = JSON.parse(e.postData.contents);
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
      photoUrls.join(', ')
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

function doGet(e) {
  if (e.parameter && e.parameter.action === 'reports') {
    return respond({ ok: true, reports: listReports() });
  }
  return respond({ ok: true, message: 'Expense Hub Mobile sync endpoint is live.' });
}

// Only knows about reports this phone has itself typed at capture time --
// there is no connection here to the PC's real Expense Hub reports, that
// is a separate, not-yet-built piece. This groups what already exists in
// this same sheet by ReportType + ReportName so a repeated name can be
// picked instead of retyped, and so the Reports tab has something to show.
function listReports() {
  var sheet = getOrCreateSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 3, lastRow - 1, 6).getValues(); // ReportType..Currency
  var byKey = {};
  values.forEach(function(row) {
    var type = row[0], name = row[1], amount = Number(row[4]) || 0, currency = row[5] || '';
    if (!type) return;
    var key = type + '|' + name;
    if (!byKey[key]) byKey[key] = { type: type, name: name, count: 0, total: 0, currency: currency };
    byKey[key].count += 1;
    byKey[key].total += amount;
  });
  return Object.keys(byKey).map(function(k) { return byKey[k]; });
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'Timestamp', 'LocalId', 'ReportType', 'ReportName', 'Date',
      'Category', 'Amount', 'Currency', 'Description', 'PaidWith', 'PhotoUrls'
    ]);
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
