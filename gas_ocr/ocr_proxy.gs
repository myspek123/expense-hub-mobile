// Expense Hub receipt OCR proxy.
// This is a separate Apps Script Web App from apps-script.gs. It does not
// read or write the mobile sync Sheet and has its own deployment.

var OCR_VERSION = '1.8';
var OCR_MODEL = 'gemini-2.5-flash';
var OCR_MAX_IMAGE_BYTES = 15 * 1024 * 1024;

// EVERY BILLED SCAN PASSES THROUGH THIS SCRIPT, from the phone and from the
// PC alike, so this is the only place that can count them all.
//
// Scans used to be counted on the PC instead, in _ocr_costs.csv, written by
// expense_hub/ocr_worker.py. That file therefore recorded PC scans and no
// others. A scan run from the handset was billed to the same Gemini key and
// appeared nowhere at all, so the total the user could see was always lower
// than the total he was charged, with no way to tell by how much
// (2026-08-23).
//
// USD per million tokens, input then output. Google bills "thinking" at the
// output rate. THESE PRICES WILL GO STALE. They are duplicated in
// expense_hub/ocr_cost.py; correct both together.
var OCR_PRICES = {
  'gemini-2.5-pro': [1.25, 10.00],
  'gemini-2.5-flash': [0.30, 2.50],
  'gemini-2.5-flash-lite': [0.10, 0.40]
};
var COST_SHEET_NAME = 'ScanCosts';
var COST_SHEET_HEADERS = [
  'When', 'Source', 'RequestId', 'Model', 'Outcome',
  'InputTokens', 'OutputTokens', 'ThinkingTokens', 'TotalTokens', 'USD'
];

function doPost(e) {
  var requestId = '';
  var source = 'phone';
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    requestId = String(data.requestId || '');
    // The PC names itself. The phone does not send this field, so anything
    // unnamed is the handset. Do not infer it from the shape of requestId.
    source = String(data.client || '') === 'pc' ? 'pc' : 'phone';
    if (!tokenOk_(data.token)) return failure_(requestId, 'bad_token');
    if (!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')) {
      return failure_(requestId, 'no_key');
    }
    var image = decodeImage_(data.image, data.mimeType);
    if (image.error) return failure_(requestId, image.error);
    var categories = categories_(data.categories);
    var response = callGemini_(image.bytes, image.mimeType, categories);
    // Logged whether it worked or not, and logged BEFORE the answer is
    // checked. A call that reached Gemini and then failed on the way back was
    // still charged for, and an attempt that never reached Gemini is worth
    // seeing beside it as a zero. That distinction is exactly what could not
    // be answered on 2026-08-23 about a phone scan that said "Failed to
    // fetch": nothing recorded whether Google had been asked at all.
    logScan_(source, requestId, response);
    if (!response.ok) return failure_(requestId, response.code, response.detail);
    var fields = normalizeFields_(response.result, categories);
    if (!fields.ok) return failure_(requestId, fields.code);
    return success_(requestId, fields, response.model, response.usage);
  } catch (err) {
    return failure_(requestId, 'unknown');
  }
}

// Cost of one call. An unknown model is priced at 0 rather than guessed, and
// still logged, so a model swap shows up as rows with a blank cost instead of
// a plausible wrong number.
function scanUsd_(model, usage) {
  var rates = OCR_PRICES[String(model || '')];
  if (!rates) return 0;
  var input = Number((usage && usage.input) || 0);
  var output = Number((usage && usage.output) || 0) + Number((usage && usage.thinking) || 0);
  return (input * rates[0] + output * rates[1]) / 1000000;
}

// Never throws. A scan must not fail because its own bookkeeping did.
function logScan_(source, requestId, response) {
  try {
    var sheet = costSheet_();
    if (!sheet) return;
    var ok = Boolean(response && response.ok);
    var usage = (response && response.usage) || {};
    var model = ok ? String(response.model || OCR_MODEL) : '';
    sheet.appendRow([
      new Date(),
      source,
      requestId,
      model,
      ok ? 'ok' : String((response && response.code) || 'unknown'),
      Number(usage.input || 0),
      Number(usage.output || 0),
      Number(usage.thinking || 0),
      Number(usage.total || 0),
      ok ? scanUsd_(model, usage) : 0
    ]);
  } catch (err) {
    // Deliberately silent here and ONLY here: this runs inside the request
    // path and there is nothing it could usefully tell the person scanning.
  }
}

// The log lives in its own spreadsheet, created on first use, its id kept in
// a Script Property. This script has no business touching the mobile sync
// Sheet, which is a separate deployment with a separate purpose.
function costSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('COST_SHEET_ID') || '';
  var book = null;
  if (id) {
    try {
      book = SpreadsheetApp.openById(id);
    } catch (err) {
      book = null; // deleted or trashed; a fresh one is made below
    }
  }
  if (!book) {
    book = SpreadsheetApp.create('Expense Hub receipt scan costs');
    props.setProperty('COST_SHEET_ID', book.getId());
  }
  var sheet = book.getSheetByName(COST_SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(COST_SHEET_NAME);
    sheet.appendRow(COST_SHEET_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Run this once from the Apps Script editor (Run > showCostSheetUrl) to find
 * where the scan cost log lives. The URL goes to the execution log rather
 * than being served over the web, so the log is never reachable without being
 * signed in to the account that owns it.
 */
function showCostSheetUrl() {
  var sheet = costSheet_();
  Logger.log(sheet.getParent().getUrl());
  return sheet.getParent().getUrl();
}

function tokenOk_(token) {
  var required = PropertiesService.getScriptProperties().getProperty('OCR_SHARED_TOKEN') || '';
  return Boolean(required) && String(token || '') === required;
}

function categories_(value) {
  if (!Array.isArray(value)) return [];
  return value.map(function(item) { return String(item || '').trim(); }).filter(Boolean);
}

function decodeImage_(encoded, mimeType) {
  var raw = String(encoded || '');
  var mime = String(mimeType || 'image/jpeg').toLowerCase();
  if (!raw || raw.indexOf('\n') >= 0 || raw.indexOf('\r') >= 0) return { error: 'bad_image' };
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mime)) return { error: 'bad_image' };
  try {
    var bytes = Utilities.base64Decode(raw);
    if (!bytes || !bytes.length) return { error: 'bad_image' };
    if (bytes.length > OCR_MAX_IMAGE_BYTES) return { error: 'too_large' };
    return { bytes: bytes, mimeType: mime };
  } catch (err) {
    return { error: 'bad_image' };
  }
}

function callGemini_(bytes, mimeType, categories) {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
  var endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    OCR_MODEL + ':generateContent?key=' + encodeURIComponent(key);
  // The category is decided by WHAT THE MERCHANT IS, not by the words on the
  // ticket. A Mercure hotel bill came back as Meals and Entertainment because
  // it listed a breakfast (user, 2026-08-16). The business the receipt comes
  // from is the answer; the line items are not.
  var categoryInstruction = categories.length
    ? [
        'Choose category exactly from this list: ' + JSON.stringify(categories) + '.',
        'Decide it from WHAT THE BUSINESS IS, using its name and letterhead, not from the individual line items.',
        'A hotel bill is lodging even when it includes breakfast, dinner, a bar tab or laundry. Hotel chains include Mercure, Ibis, Novotel, Accor, Marriott, Hilton, Holiday Inn, B&B, Campanile.',
        'A restaurant, cafe, bar or bakery is meals. A car park, parking meter or garage is parking. A train, plane, ferry, taxi, VTC or car hire is travel. A phone, internet or software bill is the IT or telephone category.',
        'If the business type and the line items disagree, follow the business type and set the category confidence to medium.'
      ].join(String.fromCharCode(10))
    : 'No category list was supplied. Do not return a category.';
  var prompt = [
    'Read this photograph of a receipt and return only the requested JSON fields.',
    'Extract the total actually paid including tax, the purchase date, the three-letter ISO currency, and a category when a list is supplied.',
    'Do not use an estimate, a pre-authorisation amount, a subtotal, a line item, or an amount not actually paid.',
    'A card slip usually prints the card masked, for example "##########1234" or "XXXX XXXX XXXX 1234". Return its LAST FOUR DIGITS as card_last4, digits only.',
    'Return null for card_last4 when the receipt shows no card number, when it was paid in cash, or when fewer than four digits are legible. Never return digits taken from a phone number, a VAT number, a till number, a date or a total.',
    'The currency comes from the SYMBOL OR CODE PRINTED ON THE RECEIPT, never from what is usual. "£" is GBP, "$" is USD, "€" is EUR, "CHF" is CHF, "AED" or "DH" is AED, "₪" is ILS. A London receipt in pounds is GBP even though most receipts you see are in euros.',
    'If no symbol or code is printed, use the country: a UK address means GBP, a US address means USD, a French one EUR. Set the currency confidence to low when you are inferring it rather than reading it.',
    'Return null for any field you cannot read with confidence instead of guessing.',
    'Return the date as YYYY-MM-DD.',
    'Work out the date order from the receipt itself, not from a fixed rule. A French or other European receipt prints DAY/MONTH/YEAR, so "11/08/26" is the 11th of August 2026. A United States receipt prints MONTH/DAY/YEAR, so "08/11/26" there is the same day.',
    'Use the language, the currency, the address and the tax wording to decide which country it is from. EUR with French words is day-first. USD with a state abbreviation or "SALES TAX" is month-first.',
    'When the two readings are both possible and the country is unclear, choose the one nearer to today.',
    'A two-digit year is 20xx. A receipt is recent: any year before 2020 means you have read the day or the month as the year, so read it again.',
    'Set confidence low when text is faded, cropped, creased, blurred, or partly obscured.',
    categoryInstruction
  ].join('\n');
  var payload = {
    contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: mimeType, data: Utilities.base64Encode(bytes) } },
      { text: prompt }
    ]}],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema_(categories),
      temperature: 0
    }
  };
  var result;
  try {
    result = UrlFetchApp.fetch(endpoint, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
  } catch (err) {
    return { ok: false, code: 'timeout' };
  }
  var status = result.getResponseCode();
  var text = result.getContentText();
  // Google says WHICH limit was hit and when it resets. Throwing that away
  // left "Receipt scanning is busy" as the only clue, and no way to tell a
  // burst of requests from a daily allowance that is simply spent
  // (2026-08-16: a whole evening lost to guessing which).
  if (status === 429) return { ok: false, code: 'rate_limited', detail: apiMessage_(text) };
  if (status === 408) return { ok: false, code: 'timeout' };
  if (status === 400) return { ok: false, code: 'bad_image' };
  if (status === 401 || status === 403) return { ok: false, code: 'no_key' };
  if (status === 500 || status === 502 || status === 503 || status === 504) return { ok: false, code: 'overloaded' };
  if (status < 200 || status >= 300) return { ok: false, code: 'unknown' };
  try {
    var body = JSON.parse(text);
    var candidates = body.candidates || [];
    if (!candidates.length) {
      if ((body.promptFeedback && String(body.promptFeedback.blockReason || '')).toUpperCase()) return { ok: false, code: 'blocked' };
      return { ok: false, code: 'unknown' };
    }
    var finish = String(candidates[0].finishReason || '').toUpperCase();
    if (finish === 'SAFETY' || finish === 'BLOCKLIST' || finish === 'PROHIBITED_CONTENT') return { ok: false, code: 'blocked' };
    var parts = candidates[0].content && candidates[0].content.parts || [];
    var raw = parts.map(function(part) { return part.text || ''; }).join('');
    var usage = body.usageMetadata || {};
    return {
      ok: true,
      result: JSON.parse(raw),
      model: OCR_MODEL,
      usage: {
        input: Number(usage.promptTokenCount || 0),
        output: Number(usage.candidatesTokenCount || 0),
        thinking: Number(usage.thoughtsTokenCount || 0),
        total: Number(usage.totalTokenCount || 0)
      }
    };
  } catch (err) {
    return { ok: false, code: 'unknown' };
  }
}

function apiMessage_(text) {
  try {
    var body = JSON.parse(text);
    var message = body && body.error && body.error.message ? String(body.error.message) : '';
    return message.slice(0, 300);
  } catch (err) {
    return String(text || '').slice(0, 300);
  }
}

function responseSchema_(categories) {
  var properties = {
    amount: { type: 'NUMBER', nullable: true },
    date: { type: 'STRING', nullable: true },
    currency: { type: 'STRING', nullable: true },
    card_last4: { type: 'STRING', nullable: true },
    confidence: confidenceSchema_()
  };
  var ordering = ['amount', 'date', 'currency', 'card_last4'];
  if (categories.length) {
    properties.category = { type: 'STRING', enum: categories, nullable: true };
    ordering.push('category');
  }
  ordering.push('confidence');
  return { type: 'OBJECT', properties: properties, required: ordering, propertyOrdering: ordering };
}

function confidenceSchema_() {
  var properties = {
    amount: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    date: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    currency: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    category: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    card_last4: { type: 'STRING', enum: ['high', 'medium', 'low'] }
  };
  return { type: 'OBJECT', properties: properties, required: ['amount', 'date', 'currency', 'category', 'card_last4'], propertyOrdering: ['amount', 'date', 'currency', 'category', 'card_last4'] };
}

function normalizeFields_(result, categories) {
  if (!result || typeof result !== 'object') return { ok: false, code: 'unknown' };
  var confidence = result.confidence || {};
  var fields = {
    amount: result.amount == null ? null : Number(result.amount),
    date: result.date == null ? null : String(result.date),
    currency: result.currency == null ? null : String(result.currency).toUpperCase(),
    category: categories.length ? (result.category != null ? String(result.category) : null) : null,
    card_last4: result.card_last4 == null ? null : String(result.card_last4).replace(/\D/g, '')
  };
  if (fields.amount != null && (!isFinite(fields.amount) || fields.amount < 0)) return { ok: false, code: 'unknown' };
  if (fields.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) fields.date = null;
  if (fields.currency != null && !/^[A-Z]{3}$/.test(fields.currency)) fields.currency = null;
  // A category outside the list is not a reason to throw the whole receipt
  // away: the amount and the date are still worth having. Drop the category
  // and keep the rest.
  if (categories.length && fields.category != null && categories.indexOf(fields.category) < 0) fields.category = null;
  // Four digits or nothing. A partial read is worse than no read: it would
  // either match no card, or match the wrong one.
  if (fields.card_last4 != null && !/^\d{4}$/.test(fields.card_last4)) fields.card_last4 = null;
  ['amount', 'date', 'currency', 'category', 'card_last4'].forEach(function(name) {
    if (['high', 'medium', 'low'].indexOf(String(confidence[name] || 'low')) < 0) confidence[name] = 'low';
  });
  return { ok: true, fields: fields, confidence: confidence };
}

function success_(requestId, fields, model, usage) {
  return respond_({version: OCR_VERSION, ok: true, requestId: requestId, fields: fields.fields, confidence: fields.confidence, model: model, usage: usage || {}});
}

function failure_(requestId, code, detail) {
  var messages = {
    bad_token: 'The scan request was not accepted.', no_key: 'Receipt scanning is not configured yet.',
    bad_image: 'That receipt image could not be read.', too_large: 'That receipt image is too large to scan.',
    rate_limited: 'Receipt scanning is busy. Try again later.', overloaded: 'Receipt scanning is busy. Try again later.',
    timeout: 'Receipt scanning took too long. Try again.', blocked: 'This receipt image could not be scanned.',
    unknown: 'Receipt scanning failed. Try again.'
  };
  var safeCode = messages[code] ? code : 'unknown';
  return respond_({version: OCR_VERSION, ok: false, requestId: requestId, model: OCR_MODEL, error: {code: safeCode, message: messages[safeCode], detail: detail || ''}});
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
