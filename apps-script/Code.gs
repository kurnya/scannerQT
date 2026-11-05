/**
 * Apps Script untuk "Kartu ke Sheet".
 * - Menyimpan API key Gemini (di Script Properties, BUKAN di kode).
 * - Membaca foto kartu lewat Gemini dan mengembalikan JSON.
 * - Menulis satu baris per kartu ke sheet "Kartu".
 *
 * Script Properties yang wajib diisi (Project Settings > Script Properties):
 *   GEMINI_API_KEY    : key dari Google AI Studio
 *   PIN               : kode bebas, dimasukkan sekali di aplikasi HP
 * Opsional (cadangan):
 *   GEMINI_API_KEY_2, GEMINI_API_KEY_3, ... : key tambahan, dicoba berurutan
 *     bila key sebelumnya kena batas kuota (429) atau tidak valid.
 *     Agar benar-benar menambah kuota, tiap key harus dari PROJECT berbeda.
 *   GEMINI_MODEL      : satu atau beberapa model dipisah koma, dicoba berurutan.
 *     Default "gemini-3.6-flash,gemini-3.5-flash-lite".
 */

var SHEET_NAME = 'Kartu';
var HEADERS = ['Waktu', 'No. Kartu', 'Nama Surah', 'Ayat', 'Terjemahan', 'Insight', 'What To Do'];
var FIELDS = ['noKartu', 'namaSurah', 'ayat', 'terjemahan', 'insight', 'whatToDo'];
var DEFAULT_MODEL = 'gemini-3.6-flash,gemini-3.5-flash-lite';
var MAX_ATTEMPTS = 8;          // batas percobaan key x model per permintaan
var REST_PER_MINUTE = 60;      // detik istirahat bila kena batas per menit
var REST_PER_DAY = 21600;      // 6 jam (maksimum CacheService) bila kuota harian habis
var MAX_IMAGE_B64 = 6 * 1024 * 1024; // ~4.5 MB per gambar
var MAX_FIELD = 5000;

/** Jalankan sekali dari editor: membuat sheet + judul kolom dan memicu izin akses. */
function setup() {
  var sh = getSheet_();
  var props = PropertiesService.getScriptProperties();
  var missing = ['GEMINI_API_KEY', 'PIN'].filter(function (k) { return !props.getProperty(k); });
  // Panggilan ringan agar izin "terhubung ke layanan eksternal" ikut diminta.
  UrlFetchApp.fetch('https://generativelanguage.googleapis.com/', { muteHttpExceptions: true });
  Logger.log('Sheet "' + sh.getName() + '" siap.');
  Logger.log(missing.length ? 'BELUM diisi di Script Properties: ' + missing.join(', ') : 'Script Properties lengkap.');
  Logger.log('Jumlah key: ' + getKeys_(props).length + ' | Model: ' + getModels_(props).join(', '));
}

/** Opsional: cek tiap key satu per satu (tanpa gambar) dan tampilkan hasilnya di log. */
function cekSemuaKey() {
  var props = PropertiesService.getScriptProperties();
  var keys = getKeys_(props);
  var model = getModels_(props)[0];
  keys.forEach(function (key, i) {
    var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Balas: OK' }] }] }),
      muteHttpExceptions: true
    });
    Logger.log('Key #' + (i + 1) + ' (' + model + '): kode ' + res.getResponseCode() + (res.getResponseCode() === 200 ? ' — berfungsi' : ''));
  });
}

/** Opsional: hapus status "istirahat" semua key (misalnya setelah kuota direset). */
function resetIstirahatKey() {
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  var names = [];
  getKeys_(props).forEach(function (k) { getModels_(props).forEach(function (m) { names.push(restKey_(k, m)); }); });
  cache.removeAll(names);
  Logger.log('Status istirahat dihapus untuk ' + names.length + ' kombinasi key x model.');
}

function doGet() {
  return json_({ ok: true, message: 'Kartu ke Sheet aktif. Gunakan dari aplikasi.' });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var props = PropertiesService.getScriptProperties();
    var pin = props.getProperty('PIN');
    if (!pin) return json_(fail_('config', 'PIN belum diatur di Script Properties Apps Script.'));
    if (String(req.pin || '') !== String(pin)) {
      Utilities.sleep(1000);
      return json_(fail_('pin', 'PIN salah. Periksa PIN di Pengaturan aplikasi.'));
    }
    switch (req.action) {
      case 'ping': return json_({ ok: true, sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() });
      case 'read': return json_(readCard_(req.images, props));
      case 'save': return json_(saveEntry_(req.entry));
      default: return json_(fail_('action', 'Aksi tidak dikenal.'));
    }
  } catch (err) {
    return json_(fail_('server', 'Kesalahan di Apps Script: ' + (err && err.message ? err.message : err)));
  }
}

/* ---------------- Baca kartu lewat Gemini ---------------- */

function buildPrompt_(hasFront, hasBack) {
  return [
    'Terlampir foto sebuah kartu renungan Al-Qur\'an' + (hasFront && hasBack ? ' (sisi DEPAN dan sisi BELAKANG, diberi label).' : '.'),
    'Sisi depan berisi nomor kartu (angka kecil), rujukan ayat seperti "QS At-Tahrim: 6", dan terjemahan ayat di dalam tanda kutip.',
    'Sisi belakang berisi bagian berjudul "Insight" dan "What to do".',
    'Foto bisa miring atau terputar; baca sesuai arah teksnya.',
    'Salin teks persis seperti tertulis, tanpa menerjemahkan, tanpa menambah, dan tanpa memperbaiki ejaan.',
    'Abaikan nama akun media sosial (misalnya @TheLivingQuran), logo, ilustrasi, dan tulisan watermark.',
    'Gabungkan baris yang terpotong karena lebar kartu menjadi kalimat utuh.',
    'Jangan sertakan label "Insight :" atau "What to do:", dan buang tanda kutip pembuka/penutup pada terjemahan.',
    'Balas HANYA dengan satu objek JSON berbentuk:',
    '{"noKartu":"","namaSurah":"","ayat":"","terjemahan":"","insight":"","whatToDo":""}',
    'Aturan kolom: namaSurah tanpa awalan "QS" (contoh "At-Tahrim"); ayat hanya nomor atau rentang (contoh "6" atau "1-5"); noKartu hanya angkanya.',
    'Kolom yang tidak ada di foto diisi string kosong. Bagian yang tidak terbaca ditulis [tidak terbaca].'
  ].join(' ');
}

/* ---------------- Daftar key & model ---------------- */

function getKeys_(props) {
  var all = props.getProperties();
  var names = Object.keys(all).filter(function (k) { return /^GEMINI_API_KEY(_\d+)?$/.test(k); });
  names.sort(function (a, b) {
    var na = a === 'GEMINI_API_KEY' ? 1 : Number(a.split('_').pop());
    var nb = b === 'GEMINI_API_KEY' ? 1 : Number(b.split('_').pop());
    return na - nb;
  });
  var seen = {}, keys = [];
  names.forEach(function (n) {
    // Satu properti juga boleh berisi beberapa key dipisah koma / baris baru
    String(all[n]).split(/[\s,;]+/).forEach(function (k) {
      if (k && !seen[k]) { seen[k] = true; keys.push(k); }
    });
  });
  return keys;
}

function getModels_(props) {
  var list = String(props.getProperty('GEMINI_MODEL') || DEFAULT_MODEL).split(/[\s,;]+/).filter(String);
  return list.length ? list : DEFAULT_MODEL.split(',');
}

// Nama cache untuk status "istirahat" — memakai hash, bukan key aslinya
function restKey_(key, model) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key + '|' + model);
  return 'rest_' + Utilities.base64EncodeWebSafe(d).slice(0, 22);
}

// Panggil Gemini dengan rotasi model x key. Mengembalikan {ok, json, model, keyNo} atau {ok:false, ...}
function callGeminiWithFallback_(payload, props) {
  var keys = getKeys_(props);
  if (!keys.length) return fail_('config', 'GEMINI_API_KEY belum diatur di Script Properties Apps Script.');
  var models = getModels_(props);
  var cache = CacheService.getScriptCache();
  var attempts = 0, lastFail = null, skippedResting = 0;

  for (var m = 0; m < models.length; m++) {
    for (var k = 0; k < keys.length; k++) {
      if (attempts >= MAX_ATTEMPTS) break;
      var model = models[m], key = keys[k], rk = restKey_(key, model);
      if (cache.get(rk)) { skippedResting++; continue; }
      attempts++;

      var res;
      try {
        res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-goog-api-key': key },
          payload: payload,
          muteHttpExceptions: true
        });
      } catch (err) {
        lastFail = fail_('network', 'Apps Script gagal menghubungi Gemini. Coba lagi.');
        continue;
      }
      var code = res.getResponseCode();
      var body = res.getContentText();
      if (code === 200) return { ok: true, body: body, model: model, keyNo: k + 1 };

      lastFail = geminiHttpError_(code, body, model);
      if (code === 429) {
        // Kuota harian vs per menit: istirahatkan sesuai jenisnya
        var perDay = /PerDay/i.test(body);
        cache.put(rk, '1', perDay ? REST_PER_DAY : REST_PER_MINUTE);
        continue;
      }
      if (lastFail.error === 'auth') { cache.put(rk, '1', REST_PER_DAY); continue; } // key salah: lewati
      if (code === 404) break;            // model tidak ada: langsung ke model berikutnya
      if (code >= 500) continue;          // server sibuk: coba kombinasi lain
      return lastFail;                    // 400 gambar dsb.: tidak ada gunanya mencoba key lain
    }
  }
  if (!lastFail && skippedResting) {
    return fail_('quota', 'Semua key sedang kena batas kuota. Tunggu sekitar 1 menit (atau sampai kuota harian direset) lalu coba lagi.');
  }
  if (lastFail && lastFail.error === 'quota') {
    lastFail.message = 'Semua key (' + keys.length + ') dan model cadangan sedang kena batas kuota. Tunggu sebentar lalu coba lagi, atau tambah key dari project lain.';
  }
  return lastFail || fail_('server', 'Gemini tidak bisa dipanggil.');
}

function readCard_(images, props) {
  if (!Array.isArray(images) || images.length < 1 || images.length > 2) return fail_('image', 'Kirim 1 atau 2 foto (depan dan/atau belakang).');

  var parts = [];
  var hasFront = false, hasBack = false;
  for (var i = 0; i < images.length; i++) {
    var im = images[i] || {};
    if (typeof im.data !== 'string' || !im.data) return fail_('image', 'Data gambar kosong.');
    if (im.data.length > MAX_IMAGE_B64) return fail_('image', 'Gambar terlalu besar.');
    var mime = /^image\/(jpeg|png|webp)$/.test(im.mimeType) ? im.mimeType : 'image/jpeg';
    var side = im.side === 'belakang' ? 'belakang' : 'depan';
    if (side === 'depan') hasFront = true; else hasBack = true;
    parts.push({ text: 'Sisi ' + side.toUpperCase() + ':' });
    parts.push({ inlineData: { mimeType: mime, data: im.data } });
  }
  parts.unshift({ text: buildPrompt_(hasFront, hasBack) });

  var call = callGeminiWithFallback_(JSON.stringify({
    contents: [{ role: 'user', parts: parts }],
    generationConfig: { responseMimeType: 'application/json' }
  }), props);
  if (!call.ok) return call;

  var j;
  try { j = JSON.parse(call.body); } catch (e) { return fail_('empty', 'Respons Gemini tidak bisa dibaca.'); }
  if (j.promptFeedback && j.promptFeedback.blockReason) {
    return fail_('blocked', 'Foto diblokir filter keamanan Gemini (' + j.promptFeedback.blockReason + ').');
  }
  var c = (j.candidates || [])[0];
  var text = '';
  if (c && c.content && c.content.parts) {
    text = c.content.parts.filter(function (p) { return typeof p.text === 'string' && !p.thought; })
      .map(function (p) { return p.text; }).join('');
  }
  if (!text.trim()) {
    var fr = c && c.finishReason;
    if (fr && fr !== 'STOP') return fail_('blocked', 'Gemini menghentikan jawaban (' + fr + ').');
    return fail_('empty', 'Gemini mengirim respons kosong. Coba lagi.');
  }

  var data = parseJsonLoose_(text);
  if (!data) return fail_('empty', 'Jawaban Gemini bukan JSON yang valid. Coba lagi.');
  var entry = {};
  FIELDS.forEach(function (f) { entry[f] = data[f] == null ? '' : String(data[f]).trim(); });
  var empty = FIELDS.every(function (f) { return !entry[f]; });
  return { ok: true, empty: empty, entry: entry, via: call.model + ', key #' + call.keyNo };
}

function parseJsonLoose_(t) {
  var s = String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(s); } catch (e) {}
  var a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) {} }
  return null;
}

function geminiHttpError_(code, bodyText, model) {
  var msg = '';
  try { var j = JSON.parse(bodyText); msg = (j.error && j.error.message) || ''; } catch (e) {}
  msg = String(msg).slice(0, 200);
  var d = msg ? ' (' + msg + ')' : '';
  if (code === 401 || code === 403 || (code === 400 && /api[_ ]?key/i.test(msg))) return fail_('auth', 'API key Gemini di Apps Script salah atau tidak aktif.' + d);
  if (code === 429) return fail_('quota', 'Kuota gratis Gemini habis atau terlalu sering. Tunggu sebentar lalu coba lagi.' + d);
  if (code === 404) return fail_('model', 'Model "' + model + '" tidak ditemukan. Ubah GEMINI_MODEL di Script Properties.' + d);
  if (code === 400 || code === 413) return fail_('image', 'Permintaan ditolak Gemini: gambar terlalu besar atau format tidak didukung.' + d);
  if (code >= 500) return fail_('server', 'Server Gemini sedang bermasalah (kode ' + code + '). Coba lagi nanti.');
  return fail_('http', 'Panggilan Gemini gagal (kode ' + code + ').' + d);
}

/* ---------------- Simpan ke Sheet ---------------- */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function clean_(v) {
  var s = v == null ? '' : String(v).slice(0, MAX_FIELD).trim();
  // Cegah teks dianggap rumus oleh Sheets
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function saveEntry_(entry) {
  if (!entry || typeof entry !== 'object') return fail_('data', 'Data kartu kosong.');
  var values = FIELDS.map(function (f) { return clean_(entry[f]); });
  if (values.every(function (v) { return !v; })) return fail_('data', 'Semua kolom kosong, tidak ada yang disimpan.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getSheet_();
    var row = sh.getLastRow() + 1;
    var range = sh.getRange(row, 1, 1, HEADERS.length);
    // Kolom teks dipaksa format teks agar "1-5" tidak berubah jadi tanggal
    sh.getRange(row, 2, 1, HEADERS.length - 1).setNumberFormat('@');
    sh.getRange(row, 1).setNumberFormat('yyyy-mm-dd hh:mm');
    range.setValues([[new Date()].concat(values)]);
    sh.getRange(row, 5, 1, 3).setWrap(true);
    return { ok: true, row: row, sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- Utilitas ---------------- */

function fail_(kind, message) { return { ok: false, error: kind, message: message }; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
