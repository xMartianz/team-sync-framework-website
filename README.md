# TeamSync

Sistem informasi pembagian beban kerja tim yang adil, transparan, dan berbasis data.

**Demo langsung (data tersimpan & dibagikan):** https://claude.ai/artifact/NZCtEVE8hQ4hrVpiAL6rQ4

## Fitur utama

1. **Dashboard Kapasitas & Beban Kerja (real-time)**: meter beban per anggota dengan indikator hijau (aman, < 70%), kuning (mendekati batas, 70–90%), dan merah (overload, > 90%). Beban PIC dan beban siaga Backup ditampilkan terpisah.
2. **Kalkulator Pembobotan Otomatis**: parameter Kompleksitas, Urgensi (otomatis dari tenggat atau manual), dan Estimasi Durasi dikonversi menjadi poin beban kerja.
3. **Auto-Assign PIC & Backup**: sistem merekomendasikan anggota dengan kapasitas tersisa paling proporsional; Team Lead dapat menerima atau mengganti pilihan.
4. **Log Transparansi & Riwayat Kinerja**: papan tugas terbuka, log aktivitas, dan laporan evaluasi berkala yang bisa diekspor ke CSV.

## Alur kerja

| Langkah | Peran | Penjelasan |
|---|---|---|
| 1. Setup kapasitas | Team Lead | Input anggota beserta kapasitas maksimal (bawaan: Junior 100, Middle 125, Senior 150, Lead 120 poin). |
| 2. Input tugas & pembobotan | Team Lead | Pilih kompleksitas, tenggat/urgensi, dan estimasi jam; sistem menghitung Total Bobot Tugas. |
| 3. Smart assignment | Team Lead | Sistem mengurutkan kandidat; Team Lead menetapkan 1 PIC dan 1 Backup (beban siaga 20% dari bobot). |
| 4. Eksekusi & pemantauan | Semua anggota | Papan To Do / In Progress / Review / Done terbuka untuk semua; PIC & Backup memperbarui progres. |
| 5. Eskalasi otomatis | Sistem | Jika beban PIC > 90% atau status PIC menjadi Cuti/Sakit/Izin, muncul notifikasi dan tombol Handover ke Backup. |

## Rumus

```
Bobot   = Jam × (1 + 0,25 × (Kompleksitas − 1)) × (1 + 0,15 × (Urgensi − 1))
Beban   = Σ bobot tugas sebagai PIC + 20% × Σ bobot tugas sebagai Backup
Beban % = Beban ÷ Kapasitas × 100
```

Urgensi otomatis dari tenggat: ≤ 1 hari = 5, ≤ 3 hari = 4, ≤ 7 hari = 3, ≤ 14 hari = 2, lebih lama = 1.
Semua ambang dan koefisien dapat diubah Team Lead di halaman **Tim & Kapasitas**.

Indeks kinerja pada laporan = 60% × (poin selesai ÷ poin tertinggi tim) + 40% × persentase tepat waktu.

## Menjalankan

Aplikasi berupa satu file `index.html` tanpa proses build.

- **Di claude.ai (link demo di atas):** data tersimpan di database bersama, hak akses mengikuti menu Share (Editor = Team Lead, Contributor = Anggota).
- **Lokal / hosting statis (GitHub Pages, Netlify, dll.):** buka `index.html` di browser. Di luar claude.ai aplikasi berjalan dalam *mode pratinjau* dengan data contoh di memori (tidak tersimpan). Untuk penyimpanan permanen di hosting sendiri, lapisan penyimpanan (`put`, `patch`, `del` di dalam skrip) dapat dihubungkan ke backend seperti Firebase/Supabase.
