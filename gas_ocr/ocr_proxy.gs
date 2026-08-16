// Expense Hub receipt OCR proxy.
// This is a separate Apps Script Web App from apps-script.gs. It does not
// read or write the mobile sync Sheet and has its own deployment.

var OCR_VERSION = '1.2';
var OCR_MODEL = 'gemini-2.5-pro';
var OCR_MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function doPost(e) {
  var requestId = '';
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    requestId = String(data.requestId || '');
    if (!tokenOk_(data.token)) return failure_(requestId, 'bad_token');
    if (!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')) {
      return failure_(requestId, 'no_key');
    }
    var image = decodeImage_(data.image, data.mimeType);
    if (image.error) return failure_(requestId, image.error);
    var categories = categories_(data.categories);
    var response = callGemini_(image.bytes, image.mimeType, categories);
    if (!response.ok) return failure_(requestId, response.code);
    var fields = normalizeFields_(response.result, categories);
    if (!fields.ok) return failure_(requestId, fields.code);
    return success_(requestId, fields, response.model);
  } catch (err) {
    return failure_(requestId, 'unknown');
  }
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
    'Return null for any field you cannot read with confidence instead of guessing.',
    'Use date YYYY-MM-DD. Set confidence low when text is faded, cropped, creased, blurred, or partly obscured.',
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
  if (status === 429) return { ok: false, code: 'rate_limited' };
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
    return { ok: true, result: JSON.parse(raw), model: OCR_MODEL };
  } catch (err) {
    return { ok: false, code: 'unknown' };
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
  if (categories.length && fields.category != null && categories.indexOf(fields.category) < 0) return { ok: false, code: 'unknown' };
  // Four digits or nothing. A partial read is worse than no read: it would
  // either match no card, or match the wrong one.
  if (fields.card_last4 != null && !/^\d{4}$/.test(fields.card_last4)) fields.card_last4 = null;
  ['amount', 'date', 'currency', 'category', 'card_last4'].forEach(function(name) {
    if (['high', 'medium', 'low'].indexOf(String(confidence[name] || 'low')) < 0) confidence[name] = 'low';
  });
  return { ok: true, fields: fields, confidence: confidence };
}

function success_(requestId, fields, model) {
  return respond_({version: OCR_VERSION, ok: true, requestId: requestId, fields: fields.fields, confidence: fields.confidence, model: model});
}

function failure_(requestId, code) {
  var messages = {
    bad_token: 'The scan request was not accepted.', no_key: 'Receipt scanning is not configured yet.',
    bad_image: 'That receipt image could not be read.', too_large: 'That receipt image is too large to scan.',
    rate_limited: 'Receipt scanning is busy. Try again later.', overloaded: 'Receipt scanning is busy. Try again later.',
    timeout: 'Receipt scanning took too long. Try again.', blocked: 'This receipt image could not be scanned.',
    unknown: 'Receipt scanning failed. Try again.'
  };
  var safeCode = messages[code] ? code : 'unknown';
  return respond_({version: OCR_VERSION, ok: false, requestId: requestId, error: {code: safeCode, message: messages[safeCode]}});
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
