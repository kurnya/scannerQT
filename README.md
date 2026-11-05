# Kartu ke Sheet

Aplikasi untuk memotret kartu renungan (sisi depan dan belakang), membaca isinya dengan Gemini, lalu menyimpannya sebagai satu baris di Google Sheet.

Sebelum memotret, pilih **kategori** kartu. Setiap kategori disimpan di tab sheet sendiri:

`Pernikahan` · `Miracle` · `Penuntut Ilmu` · `Parenting` · `Healing - Bahagia` · `Healing - Takut` · `Healing - Sedih` · `Healing - Marah` · `Healing - Jenuh`

Kolom di setiap tab: **Waktu · Nama Surah · Ayat · Terjemahan · Insight · What To Do**

Untuk menambah atau mengubah kategori, ubah `CATEGORIES` di **dua tempat dengan isi yang sama**: `apps-script/Code.gs` dan `app.js`.

```
HP (GitHub Pages) --foto--> Apps Script milik Anda --> Gemini
                                   |
                                   +--> tulis baris ke Google Sheet
```

API key Gemini **tidak** ada di kode situs dan tidak disimpan di HP. Key hanya disimpan di Apps Script (Script Properties) milik akun Google Anda. HP cukup tahu alamat Apps Script dan PIN.

> **Peringatan:** foto yang dikirim ke Gemini versi gratis bisa dipakai Google untuk melatih model. Jangan gunakan untuk dokumen pribadi atau sensitif.

## Isi folder

| File | Fungsi | Diunggah ke |
|---|---|---|
| `index.html`, `style.css`, `app.js` | Aplikasi di HP | GitHub (Pages) |
| `apps-script/Code.gs` | Penghubung ke Gemini dan Sheet | Apps Script (disalin-tempel) |

---

## Langkah 1 — Buat API key Gemini

1. Buka https://aistudio.google.com/apikey dan masuk dengan akun Google.
2. Klik **Create API key**, lalu salin key-nya (diawali `AIza...`).
3. Jangan bagikan key ini ke siapa pun.

## Langkah 2 — Buat Google Sheet dan Apps Script

1. Buka https://sheets.new untuk membuat spreadsheet baru, lalu beri nama, misalnya `Kartu Renungan`.
2. Di menu, pilih **Ekstensi > Apps Script** (Extensions > Apps Script).
3. Hapus isi `Code.gs` yang ada, lalu tempel seluruh isi file `apps-script/Code.gs` dari folder ini. Klik ikon **Simpan**.
4. Di kiri, klik ikon roda gigi **Setelan Project** (Project Settings). Gulir ke **Properti skrip** (Script Properties), klik **Tambahkan properti skrip**, lalu isi:

   | Properti | Nilai |
   |---|---|
   | `GEMINI_API_KEY` | key dari Langkah 1 |
   | `PIN` | kode bebas buatan Anda, misalnya `kartu2026` (jangan terlalu pendek) |
   | `GEMINI_MODEL` | *(opsional)* default `gemini-3.6-flash` |

   Klik **Simpan properti skrip**.
5. Kembali ke **Editor** (ikon `< >`). Di bilah atas, pilih fungsi **`setup`**, lalu klik **Jalankan** (Run).
   - Google akan meminta izin. Pilih akun Anda. Bila muncul *"Google belum memverifikasi aplikasi ini"*, klik **Lanjutan** (Advanced), lalu **Buka ... (tidak aman)**. Ini wajar karena script buatan Anda sendiri.
   - Setelah selesai, sheet bernama **Kartu** dengan judul kolom akan muncul di spreadsheet.

### (Opsional) Key cadangan bila kuota habis

Tambahkan properti `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, dan seterusnya. Bila key pertama kena batas kuota (429) atau tidak valid, script otomatis mencoba key berikutnya. Key yang sedang habis diistirahatkan dulu: 1 menit untuk batas per menit, 6 jam untuk batas harian.

- **Kuota gratis dihitung per *project*, bukan per key.** Key cadangan harus dibuat di **project berbeda**. Caranya: di https://aistudio.google.com/apikey klik **Create API key**, lalu pilih **Create API key in new project**.
- Properti `GEMINI_MODEL` juga bisa berisi beberapa model dipisah koma. Defaultnya `gemini-3.6-flash,gemini-3.5-flash-lite`: bila semua key habis untuk model pertama, script mencoba model kedua, yang punya kuota sendiri.
- Untuk mengecek semua key, pilih fungsi **`cekSemuaKey`** di editor lalu klik **Run**. Hasilnya tampil di log.
- Penambahan key dan model **tidak perlu deploy ulang**.
- Membuat banyak akun Google hanya untuk menghindari batas kuota bisa melanggar ketentuan layanan Google. Bila kebutuhan scan memang besar, aktifkan penagihan (billing) di salah satu project. Biayanya kecil untuk volume kartu seperti ini.

## Langkah 3 — Deploy sebagai Web App

1. Di Apps Script, klik **Terapkan > Deployment baru** (Deploy > New deployment).
2. Klik ikon roda gigi di samping "Pilih jenis", lalu pilih **Aplikasi web** (Web app).
3. Isi:
   - **Jalankan sebagai** (Execute as): **Saya** (Me)
   - **Yang memiliki akses** (Who has access): **Siapa saja** (Anyone). Ini wajib agar HP bisa memanggil. Keamanan dijaga oleh PIN.
4. Klik **Terapkan** (Deploy), lalu salin **URL aplikasi web** yang berakhiran `/exec`.

> Bila nanti `Code.gs` diubah, perubahan **belum** aktif sampai Anda memilih **Terapkan > Kelola deployment > ikon pensil > Versi: Versi baru > Terapkan**. Alamat `/exec` tetap sama.

## Langkah 4 — Pasang aplikasi di GitHub Pages

1. Di https://github.com, klik **+ > New repository**, beri nama misalnya `kartu-ke-sheet`, pilih **Public**, lalu **Create repository**.
2. Klik **Add file > Upload files**, unggah **`index.html`, `style.css`, dan `app.js`**, lalu klik **Commit changes**. Folder `contoh/` tidak perlu diunggah.
3. Buka **Settings > Pages**. Pada *Build and deployment*, pilih **Deploy from a branch**, Branch **main**, folder **/ (root)**, lalu **Save**.
4. Tunggu 1–2 menit. Alamat situs muncul di halaman yang sama, misalnya `https://namaanda.github.io/kartu-ke-sheet/`.

**Wajib sebelum mengunggah:** aplikasi tidak punya halaman pengaturan, jadi alamat Apps Script dan PIN diisi langsung di `app.js`, pada dua baris di bagian atas:

```js
const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/XXXX/exec';
const DEFAULT_PIN = 'pin-anda';
```

Kedua nilai ini akan terlihat oleh siapa pun yang membuka situs, jadi orang lain bisa memakai kuota Gemini Anda dan menambah baris ke Sheet. API key Gemini tetap aman di Apps Script. Bila suatu saat disalahgunakan, ganti properti `PIN` di Apps Script, lalu perbarui `app.js`. **Jangan pernah menaruh API key Gemini di `app.js`.**

## Langkah 5 — Pakai di HP

1. Buka alamat GitHub Pages di Chrome (Android) atau Safari (iPhone).
2. Pilih **kategori** (dan sub-kategori untuk Healing).
3. Ketuk **Kamera**. Jepret sisi **depan**, balik kartunya, lalu jepret sisi **belakang**. Aplikasi pindah sisi otomatis.
4. Ketuk **Baca kartu**, periksa dan perbaiki hasilnya, lalu ketuk **Kirim ke Sheet**.
5. Ketuk **Kartu baru** untuk kartu berikutnya.

Tips foto: letakkan kartu di permukaan polos, cukup terang, tanpa pantulan lampu, dan isi bingkai sebanyak mungkin. Foto miring atau terputar tidak masalah, tapi tombol putar tersedia bila perlu.

---

## Memecahkan masalah

**Kamera tidak mau terbuka**
- Kamera hanya jalan lewat `https://`, jadi buka dari alamat GitHub Pages, bukan dari file di HP.
- Izin pernah ditolak:
  - Chrome Android: ketuk ikon di kiri bilah alamat > **Izin** > **Kamera** > Izinkan, lalu muat ulang.
  - Safari iOS: **Pengaturan iPhone > Safari > Kamera** > Izinkan, atau ketuk **aA** di bilah alamat > **Pengaturan Situs Web**.
- Tutup aplikasi lain yang memakai kamera.
- Alternatif: tombol **Galeri** (juga bisa membuka kamera bawaan HP).

**"Panggilan diblokir browser (CORS)" atau "Balasan Apps Script bukan data yang diharapkan"**
- Akses Web App harus **Siapa saja** (Anyone), bukan "Siapa saja yang memiliki akun Google". Periksa di **Terapkan > Kelola deployment**.
- Pastikan alamatnya berakhiran `/exec`, bukan `/dev`.
- Setelah mengubah `Code.gs`, buat **versi baru** deployment (lihat Langkah 3).
- Matikan ekstensi pemblokir iklan/privasi yang mungkin memblokir `script.google.com`.

**"PIN di app.js tidak cocok"**: `DEFAULT_PIN` di `app.js` harus sama persis (huruf besar/kecil) dengan properti `PIN` di Apps Script. Setelah diperbaiki, unggah ulang `app.js`.

**"API key Gemini di Apps Script salah"**: periksa properti `GEMINI_API_KEY`, pastikan tanpa spasi.

**"Kuota gratis habis"**: tunggu beberapa menit. Batas harian free tier bisa dilihat di Google AI Studio.

**"Model tidak ditemukan"**: Google mengganti nama model. Lihat daftar terbaru di https://ai.google.dev/gemini-api/docs/models lalu isi properti `GEMINI_MODEL` (tidak perlu deploy ulang).

**Hasil baca kurang tepat**: foto ulang lebih dekat dan terang, atau perbaiki manual di kolom sebelum mengirim.

**Masih tampil versi lama setelah unggah ulang**: tunggu 1–2 menit, lalu muat ulang halaman. Bila perlu, tutup tab dan buka lagi.
