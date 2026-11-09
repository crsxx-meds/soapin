# RuangInap

Clinical workspace offline-first untuk visite dan SOAP rawat inap. Data tersimpan di perangkat (IndexedDB), tanpa server.

Diadaptasi dari struktur ruangdokter.github.io (repo asalnya belum mencantumkan lisensi; minta izin atau beri atribusi bila dipublikasikan luas).

## Yang berbeda dari versi dasar
- Data rawat inap per pasien: ruang, bed, tanggal MRS, DPJP, BB; hari rawat (HP) dihitung otomatis
- Daftar dikelompokkan dan difilter per ruang, tiap ruang punya warna sendiri; pencarian mencakup ruang/bed/DPJP
- Template "SOAP Rawat Inap" (bawaan) dan "Konsultasi"; field baru: [RUANG_BED], [HARI_RAWAT_LINE], [DPJP_LINE], [ASSESSMENT], [BALANCE_IF_AVAILABLE], dll.
- Form A (Assessment) terpisah dari Diagnosis; balance cairan 24 jam (IWL otomatis untuk dewasa)
- Riwayat visite harian per pasien (centang saat menyimpan)
- Status: Dirawat / Pulang (KRS)
- Kalkulator tambahan: Balance cairan, Cairan rumatan, Fungsi ginjal (CKD-EPI 2021 + Cockcroft-Gault), Osmolalitas, Berat badan ideal, Anion gap koreksi albumin
- Tema warna di `css/theme.css`; logo sementara di `assets/logo.svg`

## Menjalankan
Buka lewat server statis (mis. GitHub Pages atau `python3 -m http.server`). Service worker butuh http(s).
