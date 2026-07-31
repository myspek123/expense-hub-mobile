// Expense Hub Mobile -- Apps Script Web App
// Paste this whole file into Extensions > Apps Script on the Google Sheet
// created for mobile capture. Deploy > New deployment > Web app >
// Execute as: Me, Who has access: Anyone, then copy the deployment URL
// into the mobile page's Settings screen.
//
// Sheet columns (row 1, exact order):
// Timestamp | LocalId | ReportType | ReportName | Date | Category |
// Amount | Currency | Description | PaidWith | PhotoUrl

var SHEET_NAME = 'MobileCaptures';
var DRIVE_FOLDER_NAME = 'Expense Hub Mobile Receipts';

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = getOrCreateSheet();

    // Same LocalId arriving twice (a retried sync after a dropped
    // response) must not create a duplicate row.
    var existing = findRowByLocalId(sheet, data.localId);
    if (existing) {
      return respond({ ok: true, duplicate: true });
    }

    var photoUrl = '';
    if (data.photoBase64 && data.photoName) {
      photoUrl = savePhoto(data.photoBase64, data.photoName);
    }

    sheet.appendRow([
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
      photoUrl
    ]);

    return respond({ ok: true, duplicate: false });
  } catch (err) {
    return respond({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  return respond({ ok: true, message: 'Expense Hub Mobile sync endpoint is live.' });
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'Timestamp', 'LocalId', 'ReportType', 'ReportName', 'Date',
      'Category', 'Amount', 'Currency', 'Description', 'PaidWith', 'PhotoUrl'
    ]);
  }
  return sheet;
}

function findRowByLocalId(sheet, localId) {
  if (!localId) return null;
  var values = sheet.getRange(1, 2, sheet.getLastRow(), 1).getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === localId) return i + 1;
  }
  return null;
}

function savePhoto(base64, name) {
  var folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);
  var parts = base64.split(',');
  var meta = parts[0];
  var raw = parts[1] || parts[0];
  var mime = (meta.match(/data:(.*);base64/) || [null, 'image/jpeg'])[1];
  var blob = Utilities.newBlob(Utilities.base64Decode(raw), mime, name);
  var file = folder.createFile(blob);
  return file.getUrl();
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
