(() => {
  'use strict';

  /* =========================================================
   * KONFIGURASI TERTANAM
   * Satu-satunya tempat mengatur koneksi aplikasi.
   * - DEFAULT_SCRIPT_URL : URL Web App Apps Script (berakhiran /exec)
   * - DEFAULT_PIN        : sama persis dengan properti PIN di Apps Script
   * Catatan: kedua nilai ini terlihat oleh siapa pun yang membuka situs.
   * JANGAN PERNAH menaruh API key Gemini di file ini.
   * ========================================================= */
  const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzYcFWDCmijyVArTNXMBvRAEsPllpjQrFJtXLtBZPpEd6R-DbnavW183oWP53OpJ-Wg/exec';
  const DEFAULT_PIN = '1234';

  /* ---------------- Penyimpanan ---------------- */
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch {} }
  };
  const K = { cat: 'kartu.kategori', sub: 'kartu.sub' };
  const getUrl = () => DEFAULT_SCRIPT_URL.trim();
  const getPin = () => DEFAULT_PIN;
  // Bersihkan alamat/PIN lama yang dulu disimpan lewat halaman Pengaturan
  LS.del('kartu.url'); LS.del('kartu.pin');

  // Harus sama dengan CATEGORIES di apps-script/Code.gs
  const CATEGORIES = {
    'Pernikahan': [],
    'Miracle': [],
    'Penuntut Ilmu': [],
    'Parenting': [],
    'Healing': ['Bahagia', 'Takut', 'Sedih', 'Marah', 'Jenuh']
  };

  class AppError extends Error {
    constructor(kind, message) { super(message); this.kind = kind; }
  }

  /* ---------------- DOM ---------------- */
  const $ = id => document.getElementById(id);
  const el = {
    viewMain: $('viewMain'),
    slots: $('slots'), camView: $('camView'), camTitle: $('camTitle'), video: $('video'),
    slotTools: $('slotTools'), activeName: $('activeName'), imgBar: $('imgBar'),
    fileInput: $('fileInput'),
    btnRead: $('btnRead'), btnReadLabel: $('btnReadLabel'), btnStop: $('btnStop'), status: $('status'),
    fSurah: $('fSurah'), fAyat: $('fAyat'), fTerjemahan: $('fTerjemahan'), fInsight: $('fInsight'), fWhat: $('fWhat'),
    btnSend: $('btnSend'), btnSendLabel: $('btnSendLabel'), sendStatus: $('sendStatus'), sheetLink: $('sheetLink')
  };
  const FIELD_MAP = { namaSurah: 'fSurah', ayat: 'fAyat', terjemahan: 'fTerjemahan', insight: 'fInsight', whatToDo: 'fWhat' };
  const SIDE_NAME = { depan: 'Depan', belakang: 'Belakang' };

  function setMsg(node, msg, kind, busy) {
    node.className = 'status ' + (kind || 'info');
    node.textContent = '';
    if (busy) {
      const sp = document.createElement('span');
      sp.className = 'spinner'; sp.setAttribute('aria-hidden', 'true');
      node.appendChild(sp);
    }
    if (msg) node.appendChild(document.createTextNode(msg));
  }
  const setStatus = (m, k, b) => setMsg(el.status, m, k, b);
  const setSend = (m, k, b) => setMsg(el.sendStatus, m, k, b);

  /* ---------------- Kategori ---------------- */
  const cat = {
    kategori: CATEGORIES[LS.get(K.cat)] ? LS.get(K.cat) : '',
    sub: ''
  };
  if (cat.kategori && CATEGORIES[cat.kategori].includes(LS.get(K.sub))) cat.sub = LS.get(K.sub);

  const needsSub = () => !!cat.kategori && CATEGORIES[cat.kategori].length > 0;
  const categoryReady = () => !!cat.kategori && (!needsSub() || !!cat.sub);
  const sheetLabel = () => cat.kategori ? (needsSub() ? cat.kategori + ' - ' + (cat.sub || '…') : cat.kategori) : '';

  function fillSelect(sel, placeholder, items, current) {
    sel.textContent = '';
    const ph = new Option(placeholder, '');
    ph.disabled = true;
    sel.appendChild(ph);
    items.forEach(name => sel.appendChild(new Option(name, name)));
    sel.value = current || '';
    sel.classList.toggle('chosen', !!current);
  }

  function renderCategory() {
    fillSelect($('selCat'), '— Pilih kategori —', Object.keys(CATEGORIES), cat.kategori);
    const subs = cat.kategori ? CATEGORIES[cat.kategori] : [];
    $('subWrap').classList.toggle('hidden', !subs.length);
    if (subs.length) {
      $('hSub').textContent = 'Sub-kategori ' + cat.kategori;
      fillSelect($('selSub'), '— Pilih sub-kategori —', subs, cat.sub);
    }
    const hint = $('catHint');
    if (categoryReady()) {
      hint.innerHTML = '';
      hint.append('Disimpan ke tab ', Object.assign(document.createElement('strong'), { textContent: sheetLabel() }), '.');
      $('catCard').classList.remove('need');
    } else {
      hint.textContent = needsSub() ? 'Pilih sub-kategori ' + cat.kategori + '.' : 'Pilih kategori sebelum memotret.';
    }
    const t = $('targetSheet');
    t.textContent = '';
    if (categoryReady()) t.append('Tujuan: tab ', Object.assign(document.createElement('strong'), { textContent: sheetLabel() }));
  }

  // Dipanggil sebelum memotret / mengirim. true bila kategori sudah lengkap.
  function requireCategory(msgNode) {
    if (categoryReady()) return true;
    $('catCard').classList.add('need');
    setMsg(msgNode || el.status, needsSub() ? 'Pilih sub-kategori ' + cat.kategori + ' dulu.' : 'Pilih kategori kartu dulu.', 'err');
    $('catCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return false;
  }

  /* ---------------- State ---------------- */
  const state = {
    sides: { depan: null, belakang: null }, // { source, rotation }
    active: 'depan',
    stream: null,
    readCtrl: null,
    sending: false,
    lastSentSig: null
  };
  const slotBtn = side => el.slots.querySelector('.slot[data-side="' + side + '"]');
  const other = side => side === 'depan' ? 'belakang' : 'depan';

  /* ---------------- Gambar ---------------- */
  function srcSize(src) {
    return { w: src.naturalWidth || src.videoWidth || src.width, h: src.naturalHeight || src.videoHeight || src.height };
  }

  function renderTo(canvas, src, rotation, maxSide) {
    const { w, h } = srcSize(src);
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const sw = Math.max(1, Math.round(w * scale)), sh = Math.max(1, Math.round(h * scale));
    const q = ((rotation % 360) + 360) % 360;
    const swap = q === 90 || q === 270;
    canvas.width = swap ? sh : sw;
    canvas.height = swap ? sw : sh;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(q * Math.PI / 180);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }

  function drawSlot(side) {
    const btn = slotBtn(side);
    const canvas = btn.querySelector('canvas');
    const empty = btn.querySelector('.empty');
    const s = state.sides[side];
    if (s) {
      renderTo(canvas, s.source, s.rotation, Math.round(400 * Math.min(3, window.devicePixelRatio || 1)));
      canvas.classList.remove('hidden');
      empty.classList.add('hidden');
    } else {
      canvas.classList.add('hidden');
      empty.classList.remove('hidden');
    }
    btn.classList.toggle('filled', !!s);
    btn.setAttribute('aria-label', 'Sisi ' + SIDE_NAME[side] + (s ? ', foto siap' : ', belum ada foto'));
  }

  function setActive(side) {
    state.active = side;
    el.slots.querySelectorAll('.slot').forEach(b => {
      const on = b.dataset.side === side;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    el.activeName.textContent = SIDE_NAME[side];
    if (state.stream) el.camTitle.textContent = 'Memotret sisi ' + SIDE_NAME[side].toLowerCase();
    updateButtons();
  }

  function setImage(side, src) {
    state.sides[side] = { source: src, rotation: 0 };
    drawSlot(side);
    updateButtons();
  }

  function clearSlot(side) {
    state.sides[side] = null;
    drawSlot(side);
    updateButtons();
  }

  function rotate(delta) {
    const s = state.sides[state.active];
    if (!s) return;
    s.rotation = (s.rotation + delta + 360) % 360;
    drawSlot(state.active);
  }

  function loadFile(file, side) {
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) { setStatus('File yang dipilih bukan gambar.', 'err'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      setImage(side, img);
      if (!state.sides[other(side)]) {
        setActive(other(side));
        setStatus('Foto ' + SIDE_NAME[side].toLowerCase() + ' siap. Sekarang pilih foto sisi ' + SIDE_NAME[other(side)].toLowerCase() + '.', 'info');
      } else {
        setStatus('Kedua sisi siap. Tekan "Baca kartu".', 'info');
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus('Gambar tidak bisa dibuka. Format ini mungkin tidak didukung browser (misalnya HEIC di Chrome). Coba pakai tombol Kamera.', 'err');
    };
    img.src = url;
  }

  function exportSide(side) {
    const s = state.sides[side];
    return new Promise((resolve, reject) => {
      const c = document.createElement('canvas');
      renderTo(c, s.source, s.rotation, 1600);
      const dataUrl = c.toDataURL('image/jpeg', 0.88);
      if (!dataUrl.startsWith('data:image/jpeg')) { reject(new AppError('image', 'Gagal menyiapkan gambar.')); return; }
      resolve({ side, mimeType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) });
    });
  }

  /* ---------------- Kamera ---------------- */
  function showCamera(on) {
    el.camView.classList.toggle('hidden', !on);
    el.slots.classList.toggle('hidden', on);
    el.slotTools.classList.toggle('hidden', on);
    updateButtons();
  }

  async function startCamera() {
    if (!requireCategory()) return;
    if (!window.isSecureContext) {
      setStatus('Kamera hanya bisa dipakai lewat HTTPS. Buka dari alamat GitHub Pages (https://...), atau gunakan Galeri.', 'err');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Browser ini tidak mendukung akses kamera langsung. Gunakan Galeri.', 'err');
      return;
    }
    setStatus('Membuka kamera…', 'info', true);
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }
        });
      } catch (e) {
        if (e && e.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        else throw e;
      }
      state.stream = stream;
      el.video.srcObject = stream;
      el.camTitle.textContent = 'Memotret sisi ' + SIDE_NAME[state.active].toLowerCase();
      showCamera(true);
      await el.video.play().catch(() => {});
      setStatus('Arahkan kamera ke sisi ' + SIDE_NAME[state.active].toLowerCase() + ' kartu, lalu tekan "Jepret".', 'info');
      $('btnShoot').focus();
    } catch (e) {
      stopCamera();
      const n = e && e.name;
      let msg;
      if (n === 'NotAllowedError' || n === 'SecurityError') msg = 'Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser (ikon di bilah alamat), lalu coba lagi. Atau gunakan Galeri.';
      else if (n === 'NotFoundError' || n === 'OverconstrainedError') msg = 'Kamera tidak ditemukan di perangkat ini. Gunakan Galeri.';
      else if (n === 'NotReadableError' || n === 'AbortError') msg = 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi lain lalu coba lagi.';
      else msg = 'Kamera tidak bisa dibuka. Gunakan Galeri.';
      setStatus(msg, 'err');
    }
  }

  function stopCamera() {
    if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
    el.video.srcObject = null;
    showCamera(false);
  }

  function shoot() {
    const v = el.video;
    if (!v.videoWidth) { setStatus('Kamera belum siap. Tunggu sebentar lalu jepret lagi.', 'err'); return; }
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const side = state.active;
    setImage(side, c);
    if (!state.sides[other(side)]) {
      setActive(other(side));
      setStatus('Sisi ' + SIDE_NAME[side].toLowerCase() + ' tersimpan. Balik kartu, lalu jepret sisi ' + SIDE_NAME[other(side)].toLowerCase() + '.', 'ok');
    } else {
      stopCamera();
      setStatus('Kedua sisi siap. Periksa fotonya, lalu tekan "Baca kartu".', 'info');
    }
  }

  /* ---------------- Panggilan ke Apps Script ---------------- */
  async function callScript(payload, signal) {
    const url = getUrl();
    const pin = getPin();
    if (!url || !pin) throw new AppError('config', 'Alamat Apps Script atau PIN belum diisi di app.js.');
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        // text/plain agar tidak memicu preflight CORS yang tidak didukung Apps Script
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ pin }, payload)),
        redirect: 'follow',
        signal,
        referrerPolicy: 'no-referrer'
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      if (navigator.onLine === false) throw new AppError('network', 'Tidak ada koneksi internet. Periksa jaringan lalu coba lagi.');
      let reachable = false;
      try { await fetch(url, { mode: 'no-cors', cache: 'no-store', signal }); reachable = true; }
      catch (e2) { if (e2 && e2.name === 'AbortError') throw e2; }
      if (reachable) throw new AppError('cors', 'Panggilan diblokir browser (CORS). Biasanya karena Web App belum di-deploy dengan akses "Anyone" (Siapa saja), atau alamatnya bukan yang berakhiran /exec. Periksa langkah Deploy di README.');
      throw new AppError('network', 'Jaringan terputus atau Apps Script tidak bisa dihubungi. Periksa koneksi lalu coba lagi.');
    }
    if (!res.ok) {
      if (res.status === 429) throw new AppError('quota', 'Terlalu banyak permintaan ke Apps Script. Tunggu sebentar lalu coba lagi.');
      throw new AppError('http', 'Apps Script membalas dengan kode ' + res.status + '. Periksa alamat Web App di app.js.');
    }
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); }
    catch { throw new AppError('config', 'Balasan Apps Script bukan data yang diharapkan. Pastikan alamat Web App benar (berakhiran /exec) dan akses diatur ke "Anyone".'); }
    if (!j.ok) {
      if (j.error === 'pin') throw new AppError('pin', 'PIN di app.js tidak cocok dengan properti PIN di Apps Script.');
      throw new AppError(j.error || 'server', j.message || 'Apps Script mengembalikan kesalahan.');
    }
    return j;
  }

  /* ---------------- Baca kartu ---------------- */
  function hasAnyImage() { return !!(state.sides.depan || state.sides.belakang); }

  function updateButtons() {
    el.btnRead.disabled = !hasAnyImage() || !!state.readCtrl || !!state.stream;
    el.imgBar.querySelectorAll('button').forEach(b => { b.disabled = !state.sides[state.active]; });
    el.btnSend.disabled = state.sending;
  }

  async function doRead() {
    if (!hasAnyImage() || state.readCtrl) return;
    const ctrl = new AbortController();
    state.readCtrl = ctrl;
    el.btnReadLabel.textContent = 'Membaca…';
    el.btnRead.setAttribute('aria-busy', 'true');
    el.btnStop.classList.remove('hidden');
    updateButtons();
    setStatus('Menyiapkan foto…', 'info', true);
    try {
      const sides = ['depan', 'belakang'].filter(s => state.sides[s]);
      const images = [];
      for (const s of sides) images.push(await exportSide(s));
      setStatus('Membaca kartu lewat Gemini… (bisa 5–30 detik)', 'info', true);
      const r = await callScript({ action: 'read', images }, ctrl.signal);
      if (r.empty) {
        setStatus('Tidak ada teks kartu terdeteksi. Coba foto ulang lebih dekat dan terang.', 'info');
        return;
      }
      for (const [k, id] of Object.entries(FIELD_MAP)) el[id].value = (r.entry && r.entry[k]) || '';
      state.lastSentSig = null;
      setSend('', 'info');
      const missing = sides.length < 2 ? ' Hanya satu sisi yang dibaca; lengkapi kolom yang kosong bila perlu.' : '';
      const via = r.via ? ' (' + r.via + ')' : '';
      setStatus('Selesai' + via + '. Periksa dan perbaiki hasil di bawah, lalu kirim.' + missing, 'ok');
      $('hRes').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      if (e && e.name === 'AbortError') setStatus('Dihentikan.', 'info');
      else if (e instanceof AppError) setStatus(e.message, 'err');
      else setStatus('Terjadi kesalahan tak terduga. Coba lagi.', 'err');
    } finally {
      state.readCtrl = null;
      el.btnReadLabel.textContent = 'Baca kartu';
      el.btnRead.removeAttribute('aria-busy');
      el.btnStop.classList.add('hidden');
      updateButtons();
    }
  }

  /* ---------------- Kirim ke Sheet ---------------- */
  function collectEntry() {
    const e = {};
    for (const [k, id] of Object.entries(FIELD_MAP)) e[k] = el[id].value.trim();
    return e;
  }
  const isEntryEmpty = e => Object.values(e).every(v => !v);

  async function doSend() {
    if (state.sending) return;
    const entry = collectEntry();
    if (isEntryEmpty(entry)) { setSend('Semua kolom masih kosong. Baca kartu dulu atau isi manual.', 'err'); return; }
    if (!requireCategory(el.sendStatus)) return;
    const sig = JSON.stringify([entry, cat.kategori, cat.sub]);
    if (sig === state.lastSentSig && !confirm('Data ini sudah dikirim. Kirim lagi sebagai baris baru?')) return;
    state.sending = true;
    el.btnSendLabel.textContent = 'Mengirim…';
    updateButtons();
    setSend('Menyimpan ke Google Sheet…', 'info', true);
    try {
      const r = await callScript({ action: 'save', entry, kategori: cat.kategori, sub: cat.sub || '' });
      state.lastSentSig = sig;
      setSend('Tersimpan di tab "' + (r.sheet || sheetLabel()) + '", baris ' + r.row + '. Tekan "Kartu baru" untuk kartu berikutnya.', 'ok');
      showSheetLink(r.sheetUrl);
    } catch (e) {
      if (e instanceof AppError) setSend(e.message, 'err');
      else setSend('Terjadi kesalahan tak terduga. Coba lagi.', 'err');
    } finally {
      state.sending = false;
      el.btnSendLabel.textContent = 'Kirim ke Sheet';
      updateButtons();
    }
  }

  function showSheetLink(url) {
    if (url && /^https:\/\/docs\.google\.com\//.test(url)) {
      el.sheetLink.href = url;
      el.sheetLink.classList.remove('hidden');
    }
  }

  function newCard() {
    const entry = collectEntry();
    const unsent = !isEntryEmpty(entry) && JSON.stringify([entry, cat.kategori, cat.sub]) !== state.lastSentSig;
    if (unsent && !confirm('Hasil kartu ini belum dikirim ke Sheet. Tetap mulai kartu baru?')) return;
    if (state.readCtrl) state.readCtrl.abort();
    stopCamera();
    clearSlot('depan'); clearSlot('belakang');
    for (const id of Object.values(FIELD_MAP)) el[id].value = '';
    state.lastSentSig = null;
    setActive('depan');
    setStatus('', 'info');
    setSend('', 'info');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- Event ---------------- */
  $('selCat').addEventListener('change', e => {
    const name = e.target.value;
    if (!CATEGORIES[name]) return;
    if (name !== cat.kategori) cat.sub = '';
    cat.kategori = name;
    LS.set(K.cat, name);
    LS.del(K.sub);
    renderCategory();
    if (needsSub()) $('selSub').focus();
  });
  $('selSub').addEventListener('change', e => {
    const name = e.target.value;
    if (!cat.kategori || !CATEGORIES[cat.kategori].includes(name)) return;
    cat.sub = name;
    LS.set(K.sub, name);
    renderCategory();
  });
  el.slots.addEventListener('click', e => {
    const b = e.target.closest('.slot');
    if (b) setActive(b.dataset.side);
  });
  $('btnCamera').addEventListener('click', startCamera);
  $('btnGallery').addEventListener('click', () => {
    if (!requireCategory()) return;
    el.fileInput.value = ''; el.fileInput.click();
  });
  el.fileInput.addEventListener('change', () => loadFile(el.fileInput.files && el.fileInput.files[0], state.active));
  $('btnShoot').addEventListener('click', shoot);
  $('btnCamCancel').addEventListener('click', () => { stopCamera(); setStatus(hasAnyImage() ? 'Kamera ditutup.' : '', 'info'); });
  $('btnRotL').addEventListener('click', () => rotate(-90));
  $('btnRotR').addEventListener('click', () => rotate(90));
  $('btnClear').addEventListener('click', () => clearSlot(state.active));
  el.btnRead.addEventListener('click', doRead);
  el.btnStop.addEventListener('click', () => { if (state.readCtrl) state.readCtrl.abort(); });
  el.btnSend.addEventListener('click', doSend);
  $('btnNew').addEventListener('click', newCard);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.stream) { stopCamera(); setStatus('Kamera ditutup karena aplikasi ditinggalkan.', 'info'); }
  });

  /* ---------------- Mulai ---------------- */
  renderCategory();
  drawSlot('depan'); drawSlot('belakang');
  setActive('depan');
})();
