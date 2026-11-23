# E-Arsip Instansi

Aplikasi arsip dokumen berbasis Electron, React, Node.js, dan PostgreSQL. Metadata dan file disimpan pada server pusat agar pengguna yang berwenang dapat mengakses ruang arsip yang sama dari beberapa komputer.

## Arsitektur

- `src/` dan `electron/` — aplikasi desktop client.
- `server/` — REST API, autentikasi sesi, hak akses, unggah/unduh, dan notifikasi SSE.
- PostgreSQL — akun, undangan, sesi, metadata, serta audit log.
- Volume file server — lampiran privat; tidak dapat diakses langsung tanpa autentikasi API.
- SSE menyegarkan daftar dokumen segera setelah ada perubahan; polling 30 detik tetap tersedia sebagai cadangan.

Peran akun: `admin` mengelola undangan dan dokumen, `editor` mengelola dokumen, sedangkan `viewer` hanya melihat dan mengunduh. Admin dapat membuat undangan dari dashboard atau CLI. Pendaftaran hanya dapat dilakukan dengan kode undangan yang terikat pada username dan berlaku tujuh hari.

## Menjalankan Server dengan Docker

Persyaratan: Docker Desktop / Docker Compose v2.

1. Salin `.env.example` menjadi `.env`, lalu ganti password database dan admin dengan nilai unik yang kuat. Gunakan password database base64url agar aman dipakai konfigurasi Compose. Jangan memasukkan `.env` ke Git atau membagikannya.

   ```powershell
   Copy-Item .env.example .env
   ```

2. Bangun dan jalankan PostgreSQL serta API:

   ```powershell
   docker compose up -d --build
   ```

3. Buat akun admin awal satu kali:

   ```powershell
   docker compose exec api node server/cli.js bootstrap-admin
   ```

   Kredensial admin diambil dari `.env`. Perintah ini akan gagal jika admin sudah ada.

4. Untuk membuat kode dari CLI, gunakan:

   ```powershell
   docker compose exec api node server/cli.js invite editor nama_pengguna
   ```

   Pilihan peran: `admin`, `editor`, atau `viewer`. Admin juga dapat membuat kode dari dashboard. Berikan kode hanya kepada orang yang berwenang. Pengguna memasukkan username, kode, dan password pada halaman **Buat akun**.

5. Pastikan API hidup:

   ```powershell
   Invoke-RestMethod http://localhost:3000/api/health
   ```

## Menjalankan Client

Persyaratan: Node.js 22.13+ dan npm.

```powershell
npm.cmd install
npm.cmd run dev
```

Masukkan alamat server pada halaman login, misalnya `http://192.168.1.10:3000` untuk server LAN atau `https://arsip.example.go.id` untuk server internet. Alamat server diingat pada komputer tersebut. Buat installer client dengan:

```powershell
npm.cmd run electron:build
```

## Deploy API ke Railway

Railway meng-host API dan PostgreSQL; aplikasi Electron tetap dijalankan pada komputer pengguna sebagai client. Jangan unggah `.env` atau memasukkan rahasianya ke Git.

1. Buat project Railway dan deploy repository ini dari GitHub. `railway.json` memilih `server/Dockerfile` dan pemeriksaan kesehatan `/api/health`.
2. Tambahkan database PostgreSQL pada project. Pada service API, tambahkan variable:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (sesuaikan `Postgres` dengan nama service database).
   - `EARSIP_STORAGE_PATH` = `/data/files`.
   - `EARSIP_TRUST_PROXY` = `true`.
   - `EARSIP_ADMIN_USERNAME` = username admin pilihan Anda.
   - `EARSIP_ADMIN_PASSWORD` = password unik dan kuat (minimal 8 karakter).
   - `EARSIP_ORGANIZATION_NAME` = nama instansi Anda.
3. Hubungkan PostgreSQL dengan API melalui variable reference `DATABASE_URL`; jangan salin connection string ke Git atau chat.
4. Tambahkan volume pada service API dengan mount path `/data/files`. Volume ini diperlukan agar lampiran tetap ada setelah deployment/restart.
5. Generate domain publik untuk service API. Railway menyediakan HTTPS; gunakan domain tersebut sebagai alamat server pada client.
6. Setelah database dan variable siap, jalankan bootstrap admin **satu kali** dari root repository menggunakan Railway CLI yang terhubung ke environment dan service API:

   ```powershell
   npm.cmd install --prefix server
   railway run --service <nama-service-api> npm.cmd --prefix server run bootstrap-admin
   ```

   Jangan jalankan ulang setelah admin berhasil dibuat. Buat akun lain melalui kode undangan yang dibuat admin.
7. Verifikasi `https://<domain-railway>/api/health` mengembalikan `{"status":"ok"}`, lalu masukkan `https://<domain-railway>` pada halaman login aplikasi desktop.

Tambahkan backup PostgreSQL dan volume secara berkala. Batas ukuran unggah default adalah 1 GiB; sesuaikan `EARSIP_MAX_FILE_SIZE` jika perlu dan perhatikan batas ukuran request pada platform.

Untuk akses LAN, izinkan koneksi masuk ke port server pada firewall Windows dan pastikan komputer client berada pada jaringan yang dapat menjangkaunya. Aplikasi menolak HTTP untuk alamat publik. Pengguna internet harus mengakses server melalui reverse proxy yang menyediakan HTTPS; jangan mempublikasikan port API tanpa TLS. Jika reverse proxy berjalan di host yang sama, atur `EARSIP_BIND_ADDRESS=127.0.0.1`; jika memakai satu reverse proxy, atur `EARSIP_TRUST_PROXY=true` agar pembatasan percobaan login memakai alamat client yang diteruskan proxy. HTTP hanya layak untuk jaringan lokal tepercaya.

## Data dan Operasional

Data aktif berada pada volume Docker `postgres-data` dan `document-files`. Backup keduanya secara berkala dan uji proses pemulihan. Menghapus volume Docker akan menghapus data arsip. Batas ukuran unggah default adalah 1 GiB dan dapat diubah lewat `EARSIP_MAX_FILE_SIZE`.

Database SQLite lama pada profil Windows pengguna tidak dihapus. Setelah server dan admin tersedia, impor dokumen lama dari komputer yang menyimpan database tersebut:

```powershell
npm.cmd install --prefix server
$env:EARSIP_API_URL = "http://192.168.1.10:3000"
npm.cmd run server:migrate-local
```

Perintah memakai database default pada `%APPDATA%\e-arsip-instansi\e-arsip-instansi\e-arsip-instansi.db` dan kredensial admin di `.env`. Untuk memilih database lain, atur `$env:EARSIP_LOCAL_DB` ke path file `.db`. Dokumen yang sudah diimpor dari database dan path sumber yang sama tidak digandakan saat perintah dijalankan ulang. File lokal yang hilang/berubah atau kategorinya sudah tidak didukung akan dilewati dan dilaporkan; periksa output sebelum menutup aplikasi lama. Akun lokal tidak dipindahkan—buat akun server baru melalui undangan admin. Backup database SQLite lama sebelum migrasi.

Server hanya menerima kategori dokumen yang tercantum di `shared/document-categories.json`.

## Menjalankan API Tanpa Docker (Pengembangan)

Siapkan PostgreSQL lokal, atur variabel `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, dan `PGPASSWORD`, lalu jalankan:

```powershell
npm.cmd install --prefix server
npm.cmd run server:start
```

Server otomatis membuat tabel yang dibutuhkan. Atur juga `EARSIP_STORAGE_PATH` untuk lokasi file. Untuk inisialisasi admin dan undangan, variabel koneksi yang sama harus tersedia saat menjalankan `npm.cmd run server:bootstrap-admin` atau `npm.cmd run server:invite -- editor nama_pengguna`.
