# TeamSync

Sistem informasi pembagian beban kerja tim yang adil, transparan, dan berbasis data.
Frontend statis (HTML + JavaScript, tanpa build) dengan backend **Supabase** (Postgres, Auth, Realtime).

## Fitur utama

1. **Dashboard Kapasitas & Beban Kerja (real-time)**: meter beban per anggota dengan indikator hijau (aman, < 70%), kuning (mendekati batas, 70–90%), dan merah (overload, > 90%). Beban PIC dan beban siaga Backup ditampilkan terpisah. Perubahan dari anggota lain muncul langsung lewat Supabase Realtime.
2. **Kalkulator Pembobotan Otomatis**: parameter Kompleksitas, Urgensi (otomatis dari tenggat atau manual), dan Estimasi Durasi dikonversi menjadi poin beban kerja.
3. **Auto-Assign PIC & Backup**: sistem merekomendasikan anggota dengan kapasitas tersisa paling proporsional; Team Lead dapat menerima atau mengganti pilihan.
4. **Eskalasi & Handover**: jika beban PIC > 90% atau status PIC menjadi Cuti/Sakit/Izin, muncul notifikasi dan tombol Handover. Handover dijalankan di server (`handover_task`) sehingga hanya Team Lead atau Backup tugas tersebut yang bisa melakukannya.
5. **Log Transparansi & Riwayat Kinerja**: papan tugas terbuka, log aktivitas yang tidak bisa diedit (jejak audit), dan laporan evaluasi berkala yang bisa diekspor ke CSV.
6. **Skill-Based Assignment**: setiap tugas mencantumkan skill yang dibutuhkan. Rekomendasi mengutamakan anggota yang punya kompetensi; anggota yang kosong tetapi tidak punya skill relevan tidak otomatis dipilih. Skill yang cocok dan yang kurang ditampilkan di setiap kandidat.
7. **Capacity Planning & Kalender Kerja**: sisa jam tugas disebar ke hari kerja PIC antara tanggal mulai dan tenggat, lalu dibandingkan dengan jam tersedia per minggu/bulan (jam kerja per hari, cuti, hari libur tim, dan tugas rutin). Sistem membedakan anggota yang sibuk minggu ini dari yang baru padat bulan depan, dan memperingatkan cuti mendatang yang bentrok dengan tenggat.
8. **Workload Fairness Index**: indeks keadilan (Indeks Jain, 0–100) dan ketimpangan (koefisien Gini) dihitung dari utilisasi relatif terhadap kapasitas, bukan jumlah tugas. Dashboard menampilkan sebaran utilisasi per anggota serta perubahan indeks sebelum dan sesudah setiap handover/redistribusi.
9. **What-If Scenario Simulator**: uji skenario seperti anggota cuti N hari, beberapa tugas baru masuk, atau tenggat dimajukan. Sistem menyusun alokasi yang disarankan (termasuk redistribusi otomatis agar lebih merata), membandingkan sebelum vs. sesudah, dan tidak mengubah data sampai Team Lead menekan **Terapkan**.

## Alur kerja

| Langkah | Peran | Penjelasan |
|---|---|---|
| 1. Setup kapasitas | Team Lead | Input anggota beserta kapasitas maksimal (bawaan: Junior 100, Middle 125, Senior 150, Lead 120 poin). |
| 2. Input tugas & pembobotan | Team Lead | Pilih kompleksitas, tenggat/urgensi, dan estimasi jam; sistem menghitung Total Bobot Tugas. |
| 3. Smart assignment | Team Lead | Sistem mengurutkan kandidat; Team Lead menetapkan 1 PIC dan 1 Backup (beban siaga 20% dari bobot). |
| 4. Eksekusi & pemantauan | Semua anggota | Papan To Do / In Progress / Review / Done terbuka untuk semua; PIC & Backup memperbarui progres. |
| 5. Eskalasi otomatis | Sistem | Notifikasi dan tombol Handover agar Backup mengambil alih tugas beserta bobot poinnya. |

## Rumus

```
Bobot   = Jam × (1 + 0,25 × (Kompleksitas − 1)) × (1 + 0,15 × (Urgensi − 1))
Beban   = Σ bobot tugas sebagai PIC + 20% × Σ bobot tugas sebagai Backup
Beban % = Beban ÷ Kapasitas × 100
```

Urgensi otomatis dari tenggat: ≤ 1 hari = 5, ≤ 3 hari = 4, ≤ 7 hari = 3, ≤ 14 hari = 2, lebih lama = 1.
Indeks kinerja = 60% × (poin selesai ÷ poin tertinggi tim) + 40% × persentase tepat waktu.

**Kalender kapasitas**

```
Jam tersedia  = (hari kerja − hari cuti − hari libur) × jam kerja per hari − jam rutin per minggu × (hari kerja tersedia ÷ 5)
Sisa jam tugas = estimasi jam × (To Do 100%, In Progress 60%, Review 20%)
Utilisasi jam = (sisa jam tugas PIC + 20% × sisa jam tugas Backup) di periode itu ÷ jam tersedia
```

**Keadilan beban** (u = utilisasi anggota yang hadir hari ini)

```
Indeks keadilan = (Σu)² ÷ (n × Σu²) × 100      100 = semua anggota sama beratnya
Gini            = Σ|uᵢ − uⱼ| ÷ (2 n² × rata-rata u)   0 = merata, 1 = timpang total
```

**Urutan rekomendasi**: kandidat yang tidak hadir di urutan terakhir; kandidat tanpa skill yang dibutuhkan di bawah kandidat yang punya skill (meski sedikit di atas batas merah); lalu beban tertinggi antara beban poin dan beban jam di periode tugas.
Semua ambang dan koefisien dapat diubah Team Lead di halaman **Tim & Kapasitas**.

## Struktur proyek

```
index.html            Tampilan dan gaya
app.js                Tampilan dan sinkronisasi data
planning.js           Mesin perencanaan: skill, kalender kapasitas, indeks keadilan, simulator
config.js             Alamat & anon key Supabase (diisi saat setup)
supabase/schema.sql   Tabel, Row Level Security, trigger, fungsi handover, realtime
```

## Setup dengan Supabase (± 10 menit)

1. **Buat proyek** di [supabase.com](https://supabase.com) (paket gratis cukup).
2. **Buat database**: buka *SQL Editor* → *New query*, tempel seluruh isi `supabase/schema.sql`, lalu klik *Run*. Skrip aman dijalankan ulang.
3. **Isi `config.js`**: salin *Project URL* dan *anon public key* dari *Project Settings → API* ke `config.js`.
   Anon key memang dirancang untuk dipakai di browser; keamanan data dijaga oleh Row Level Security. Jangan pernah memakai `service_role` key di frontend.
4. **Atur URL autentikasi**: di *Authentication → URL Configuration*, isi *Site URL* dengan alamat tempat aplikasi di-hosting (misalnya `https://namaanda.github.io/team-sync-framework-website/`). Ini dipakai untuk tautan konfirmasi email dan reset kata sandi.
5. **Hosting**: unggah folder ini ke hosting statis apa pun: GitHub Pages (*Settings → Pages → Deploy from branch → main*), Netlify, atau Vercel. Untuk mencoba di komputer sendiri, jalankan `npx serve .` lalu buka alamat yang muncul.
6. **Daftar sebagai Team Lead**: akun **pertama** yang mendaftar otomatis menjadi Team Lead. Setelah masuk, klik *Muat data contoh* untuk mencoba, atau langsung *Tambah anggota*.
7. **Undang tim**: bagikan alamat aplikasi. Anggota mendaftar dengan email masing-masing; Team Lead menautkan setiap akun ke profil anggotanya (atau anggota memilih sendiri lewat *Saya adalah*) di halaman **Tim & Kapasitas → Akun & peran**. Team Lead juga bisa menjadikan akun lain Team Lead dari sana.

Tanpa `config.js` yang terisi, aplikasi berjalan dalam **mode pratinjau** dengan data contoh di memori, berguna untuk demo tanpa database.

## Memperbarui database yang sudah berjalan

Setiap kali `supabase/schema.sql` berubah, jalankan ulang seluruh isinya di **SQL Editor**. Skrip menambah kolom dan tabel baru (misalnya `leaves`, `skills`, `start_date`) tanpa menghapus data yang ada.

## Keamanan & hak akses

Semua aturan ditegakkan di database (Row Level Security dan trigger), bukan hanya di tampilan:

| Data | Membaca | Mengubah |
|---|---|---|
| Anggota & kapasitas | Semua pengguna yang masuk | Team Lead |
| Tugas | Semua pengguna yang masuk (transparan) | Team Lead: semua kolom. PIC/Backup: hanya status progres |
| Handover | — | Team Lead atau Backup tugas tersebut, lewat fungsi `handover_task` |
| Log aktivitas | Semua pengguna yang masuk | Hanya menambah atas nama sendiri; tidak bisa diedit. Team Lead boleh menghapus |
| Jadwal cuti | Semua pengguna yang masuk | Team Lead, atau anggota untuk jadwalnya sendiri |
| Aturan sistem | Semua pengguna yang masuk | Team Lead |
| Peran akun | Semua pengguna yang masuk | Team Lead (minimal selalu ada satu Team Lead) |

Pengunjung yang belum masuk tidak dapat membaca data apa pun.

## Batasan saat ini

- Satu proyek Supabase melayani satu tim. Untuk banyak tim, tambahkan kolom `team_id` dan sesuaikan policy.
- Eskalasi dihitung di browser setiap kali data berubah, jadi notifikasi tampil saat aplikasi dibuka; belum ada notifikasi email/push.
- Log menampilkan 400 aktivitas terbaru; data lama tetap tersimpan di tabel `activity_logs`.
