# Warung Pak Erlangga

Game mengelola warung selama 14 hari. Antreannya bukan angka karangan: tiap pelanggan disimulasikan satu per satu dengan *discrete-event simulation*, dan hasilnya bisa dicocokkan dengan rumus teori antrean.

Tiap pagi kamu mengatur pegawai, harga, stok, dan bangku tunggu. Siangnya warung buka dan kamu menonton antreannya berjalan. Malamnya ada laporan dengan ukuran antrean yang sungguhan (ρ, Wq, Lq) dan penjelasan kenapa hari itu berakhir seperti itu.

## Cara menjalankan

Tidak ada langkah build dan tidak ada dependensi yang perlu dipasang. Yang dibutuhkan hanya server file statis, karena browser tidak memuat modul JavaScript dari `file://`.

```bash
npm start
```

Lalu buka `http://localhost:8000`. Tanpa npm, perintah ini sama saja:

```bash
python3 scripts/serve.py 8000
```

Server kecil itu sama dengan `python3 -m http.server`, hanya saja ia meminta browser tidak menyimpan salinan berkas. Permainan ini terdiri dari banyak modul kecil, dan browser yang memegang salinan lama dari satu modul di samping salinan baru dari modul lain akan menampilkan halaman kosong. Untuk kejadian yang sama di situs yang sudah tayang, `index.html` memuat ulang semua berkasnya sekali kalau halaman ternyata kosong.

Untuk GitHub Pages, cukup aktifkan Pages pada branch utama dengan folder root. Semua alamat di dalam proyek relatif, jadi tidak ada yang perlu diubah.

Perintah lain (butuh Node.js 20 atau lebih baru):

| Perintah | Kegunaan |
|---|---|
| `npm test` | Menjalankan semua tes (316 tes). |
| `npm run validate` | Mencetak perbandingan simulasi dengan teori. |
| `npm run balance` | Mencetak hitungan di balik tiap angka keseimbangan game. |

## Cara main, singkatnya

- **Tujuan**: bertahan 14 hari tanpa kehabisan kas. Bertahan dapat satu bintang, kas akhir Rp 3 juta dapat dua, Rp 5 juta dapat tiga.
- **Pagi**: atur jumlah pegawai, harga per porsi, stok masakan, dan bangku tunggu. Kalau kasnya ada, belanja di Toko Sebelah (bangku, pelatihan, mesin kasir, nomor antrean, papan shift).
- **Siang**: warung buka pukul 08.00 sampai 20.00. Ramai saat makan siang dan makan malam. Sambil menonton, pungut koin tip yang muncul di konter (pencet koinnya, atau tekan T) sebelum cincinnya habis.
- **Malam**: baca laporan, lalu coba lebih baik besok.
- Tiap hari punya satu tantangan kecil (misalnya "paling banyak 5 orang batal antre"). Kalau tercapai, hari itu dapat cap di kalender dan Rp 5.000.
- Mulai hari ke-8 sewa naik Rp 100.000 sehari dan yang datang 1,4 kali lipat: warung yang sudah dikenal lebih ramai, jadi antreannya kembali jadi soal.
- Mulai hari ke-2, kira-kira 4 dari 10 hari membawa satu kejadian: lima berupa kabar pagi (bisa disiapkan) dan lima berupa kejutan saat warung buka.

## Teori antrean yang dipakai

Warung dimodelkan sebagai antrean **M(t)/M/c(t)/K+M**:

| Bagian | Artinya | Di game |
|---|---|---|
| M(t) | Kedatangan mengikuti proses Poisson dengan laju λ(t) yang berubah menurut jam | Sepi di pagi hari, puncak saat makan siang dan makan malam |
| M | Lama pelayanan berdistribusi eksponensial dengan laju μ | Kecepatan tiap pegawai |
| c(t) | Jumlah pelayan, boleh berubah menurut jam | Jumlah pegawai, bisa diatur per shift |
| K | Kapasitas sistem: yang dilayani ditambah yang menunggu | Pegawai ditambah bangku tunggu |
| +M | Kesabaran pelanggan berdistribusi eksponensial dengan laju θ (model Erlang-A) | Pelanggan batal antre kalau menunggu terlalu lama |

Konsep yang muncul di dalamnya:

- **Proses Poisson tak homogen** dibangkitkan dengan metode *thinning* (Lewis dan Shedler): calon kedatangan dibangkitkan dengan laju tertinggi, lalu tiap calon diterima dengan peluang λ(t) dibagi laju tertinggi itu.
- **Intensitas trafik** a = λ ÷ (c·μ). Selama a di atas 1, lebih banyak yang datang daripada yang bisa dilayani, dan antrean menumpuk.
- **Utilisasi** ρ: bagian waktu pegawai yang terpakai melayani.
- **Reneging**: pelanggan yang sudah mengantre lalu pergi. Dalam model Erlang-A, banyaknya rata-rata sama dengan θ dikali total waktu tunggu semua pelanggan.
- **Balking** (di sini berupa *blocking*): pelanggan yang datang saat ke-K tempat terisi langsung pergi.
- **Hukum Little**: Lq = λ × Wq. Rata-rata panjang antrean sama dengan laju pelanggan yang masuk dikali rata-rata waktu tunggunya.
- **Kedatangan berkelompok** (*bulk arrival*): satu rombongan masuk sekaligus.
- **Simulasi berakhir** (*terminating simulation*): warung tutup pada jam tertentu, lalu yang masih di dalam dilayani sampai habis.

## Dari konsep ke mekanik permainan

| Keputusan pemain | Parameter | Akibat yang terlihat |
|---|---|---|
| Jumlah pegawai, jadwal shift | c(t) | Kapasitas c·μ naik, ρ turun, gaji naik |
| Pelatihan, mesin kasir | μ | Tiap pegawai melayani lebih cepat |
| Harga | λ(t) | Harga naik, yang datang berkurang, untung per porsi naik |
| Bangku tunggu | K − c | Lebih banyak yang bisa menunggu, lebih sedikit yang balik kanan |
| Nomor antrean | θ | Pelanggan lebih sabar, lebih sedikit yang batal antre |
| Stok | (bukan parameter antrean) | Habis berarti pelanggan ditolak, sisa berarti modal terbuang |

| Ukuran di laporan | Artinya | Pengaruhnya ke permainan |
|---|---|---|
| ρ | Utilisasi pegawai | Rendah berarti gaji terbayar untuk menunggu; mendekati 1 berarti kewalahan |
| Wq | Rata-rata waktu tunggu | Menurunkan reputasi |
| Lq | Rata-rata panjang antrean | Makin panjang, makin banyak yang batal antre |
| Batal antre (reneging) | Pergi setelah menunggu | Kehilangan penjualan, dan paling merusak reputasi |
| Penuh (balking) | Pergi karena tidak ada bangku | Kehilangan penjualan, merusak reputasi setengahnya |

Reputasi bergerak 30% ke arah skor hari itu (*exponential smoothing*), dan reputasi menentukan berapa banyak yang datang besok.

Bangku lebih banyak tidak selalu lebih baik. Kalau pegawainya kewalahan, bangku tambahan hanya mengubah orang yang tadinya balik kanan menjadi orang yang menunggu lama lalu batal antre, yang lebih merusak reputasi.

## Tantangan harian, alat ukur, dan kata pelanggan

Ketiganya hanya membaca apa yang sudah dihasilkan mesin simulasi; tidak ada yang mengubah antrean.

- **Tantangan harian.** Satu dari empat tujuan, ditentukan oleh benih permainan dan nomor hari, lalu dinilai malamnya dari angka laporan. Ambangnya adalah hari median pemain cermat (dilayani 90%, batal antre 5, lepas 17, selisih stok 10), jadi warung yang terurus mencapainya kira-kira dua hari sekali. Hadiahnya Rp 5.000 per cap: empat belas cap senilai laba satu hari biasa, supaya kas tetap jadi skor utama. Hadiah itu masuk kas, bukan laba.
- **Alat ukur saat siang.** Dua bacaan keadaan mesin detik itu juga: berapa pegawai yang sedang melayani (utilisasi ρ sesaat) dan sisa kesabaran pelanggan yang paling tidak sabar di antrean.
- **Kata pelanggan.** Paling banyak tiga pelanggan per hari, dipilih dari pelanggan yang benar-benar disimulasikan: yang paling lama menunggu sebelum batal antre, yang datang saat penuh atau kehabisan, dan yang akhirnya terlayani. Nomor pelanggan, jam datang, lama menunggu, dan akhir kunjungannya dari catatan mesin (`src/game/reviews.js`); hanya kalimatnya yang dituliskan.

## Tip: yang dikerjakan pemain saat warung buka

Pelanggan yang langsung dilayani begitu datang, tanpa sempat mengantre, kadang meninggalkan koin Rp 1.000 di konter: kira-kira satu dari lima. Koin itu tergeletak 40 menit waktu warung (empat detik pada kecepatan 1×), lalu hilang. Dipencet tepat waktu, ia masuk celengan di pojok layar dan menjadi baris "Tip" di nota malam.

Tip sengaja diletakkan **di luar model antrean**. Memungut atau melewatkan koin tidak mengubah siapa yang dilayani, berapa lama orang menunggu, atau reputasi; yang berubah hanya kas (`tests/tips.test.js` memeriksa bahwa laporan antrean hari yang sama identik dengan atau tanpa tip). Jadi semua angka di laporan tetap bisa dicocokkan dengan teori.

Yang tetap terhubung dengan antrean adalah **berapa banyak** koinnya. Koin hanya datang dari pelanggan yang tidak menunggu, dan peluang tidak menunggu adalah 1 − peluang tunda (*probability of delay*). Di pengaturan awal 97 pelanggan sehari langsung dilayani; dengan pegawai ketiga, 127. Warung yang antreannya terurus mendapat lebih banyak koin.

Tiga hal yang perlu diketahui pemain, dan dijelaskan Pak Erlangga di hari pertama (tekan celengannya untuk membaca lagi):

- makin cepat hari diputar, makin cepat koin hilang;
- selagi hari dijeda, koin tidak bisa dipungut;
- kalau langsung ke laporan, koin yang belum dipungut hangus.

## Panel "Kenapa begini?"

Tiap laporan punya tab yang menjelaskan hari itu. Yang langsung terlihat sengaja singkat: paling banyak tiga hal yang paling mahal hari itu, masing-masing satu kalimat tentang apa yang terjadi, nilainya dalam rupiah, dan satu hal yang bisa dicoba. Temuan yang lebih kecil dan seluruh hitungannya ada di bawahnya, tinggal dibuka.

Di dalam "Hitungan lengkapnya", tiap temuan ditulis dengan bahasa teori antrean dan lengkap dengan angkanya supaya bisa dihitung ulang dengan tangan. Semuanya dihitung dari laporan hari itu sendiri (`src/game/explain.js`):

- jam mana yang intensitas trafiknya di atas 1, dan berapa pelanggan yang lepas di jam itu;
- berapa yang batal antre, dibandingkan dengan θ × total waktu tunggu;
- berapa yang datang saat ke-K tempat terisi;
- berapa bagian waktu pegawai yang menganggur dan berapa gajinya;
- hukum Little dengan angka hari itu;
- stok yang kurang atau berlebih, dan nilainya;
- titik impas hari itu.

Temuan diurutkan menurut nilainya dalam rupiah, jadi yang paling atas adalah yang paling layak diperbaiki.

## Bagaimana kebenarannya diuji

Mesin simulasinya diambil dari proyek sebelumnya (QueueLab) dan diperluas. Tiap perluasan dicocokkan dengan teori, bukan hanya diperiksa jalan atau tidak:

1. **M/M/c** terhadap rumus Erlang C dari buku teks.
2. **Reneging dalam keadaan tunak** terhadap rumus M/M/c/K+M, yang diturunkan dari rantai *birth-death* dengan laju kematian min(n, c)·μ + max(n − c, 0)·θ.
3. **Satu hari penuh**, dengan laju kedatangan dan jumlah pegawai yang berubah, terhadap persamaan maju Kolmogorov yang diselesaikan secara numerik (Runge-Kutta orde 4, `src/analytic/transient.js`).
4. **Tiap jenis kejadian** (pasar malam, pegawai sakit, rombongan, gas habis, viral, keponakan membantu): ribuan hari disimulasikan dan rata-ratanya harus berada dalam 4 galat baku dari hitungan teori.

Mesin lama tidak berubah perilakunya: dengan pengaturan bawaan hasilnya identik bit demi bit dengan QueueLab (`tests/regression-golden.test.js`).

Bilangan acaknya berbenih. Tiap hari memakai deret sendiri, dan kedatangan, pelayanan, kesabaran, kejadian, serta tip memakai deret terpisah. Akibatnya permainan yang disimpan memberi hari yang sama saat dimuat lagi, dan mempercepat atau melewati animasi tidak mengubah antrean hari itu: siapa yang datang, siapa yang dilayani, berapa lama mereka menunggu. Pelanggan mana yang meninggalkan koin juga sudah tetap; satu-satunya yang bergantung pada pemain adalah koin mana yang sempat dipungut.

## Keseimbangan dari hitungan, bukan tebakan

Tiap angka keseimbangan di `src/game/config.js` punya aturan yang menghasilkannya (`scripts/derive.js`), dan tes akan gagal kalau angkanya bergeser dari aturan itu (`tests/balance.test.js`). Beberapa di antaranya:

| Angka | Aturan |
|---|---|
| Gaji Rp 8.500 per jam | Pegawai ketiga di pengaturan awal pas menutup biayanya sendiri pada hari itu |
| Stok awal 160 porsi | Kuantil *newsvendor*: porsi kurang rugi Rp 4.000, porsi lebih rugi Rp 6.000, jadi stok terbaik adalah kuantil 40% dari permintaan |
| Sewa Rp 375.000 | Pengaturan awal menyisakan sekitar 5% dari pendapatan sebagai laba |
| Kas awal Rp 1.500.000 | Cukup untuk satu hari penuh biaya walau tidak ada satu pun pelanggan |
| Harga barang di toko | Setengah dari tambahan laba yang dibawanya selama 14 hari |
| Kenaikan sewa Rp 100.000 | 1,5 kali laba harian pengaturan awal, sehingga laba tipis menjadi rugi tipis |
| Minggu kedua 1,4 kali lebih ramai | Pemain cermat (3 pegawai, Rp 13.000) di hari ke-8 punya intensitas trafik 0,71 di jam makan siang; pengalinya mengembalikannya ke 1 (36 ÷ 25,5 = 1,41) |
| Kepekaan harga Rp 5.000 | Angka model: harga terbaik tanpa antrean jadi modal + kepekaan = Rp 11.000, sehingga harga bukan satu-satunya keputusan yang menentukan |
| Ambang tantangan dan hadiah Rp 5.000 | Ambang = hari median pemain cermat; 14 cap = laba satu hari biasa di pengaturan awal |
| Peluang tip 20% | Semua koin sehari di pengaturan awal bernilai seperempat laba hari itu: 17,5 koin dari 97 pelanggan yang langsung dilayani, dibulatkan ke 5% terdekat |
| Bintang | Dua bintang di atas hasil terbaik pemain yang diam; tiga bintang di bawah hasil terburuk pemain yang cermat |

Titik impas pengaturan awal: (375.000 + 204.000) ÷ 4.000 = 145 pelanggan sehari, dari sekitar 162 yang diharapkan terlayani.

Kejadian baik dan buruk dibuat hampir saling meniadakan, sehingga kejadian menambah ketidakpastian tanpa membuat permainan lebih mudah atau lebih sulit secara rata-rata.

Hasil 300 permainan simulasi per cara bermain:

| Cara bermain | Kas akhir rata-rata | Bangkrut |
|---|---|---|
| Tidak pernah mengubah apa pun | Rp 1,13 juta | 7% |
| Hanya menyesuaikan stok dengan kabar pagi | Rp 1,68 juta | 5% |
| Hanya satu pegawai | bangkrut | 100% |
| Harga terlalu murah | bangkrut | 100% |
| Cermat (3 pegawai, harga Rp 13.000, stok mengikuti perkiraan) | Rp 6,38 juta | 0% |

Satu keputusan saja tidak cukup: harga Rp 14.000 dengan 2 pegawai rata-rata berakhir di Rp 4,92 juta, dan 3 pegawai di harga Rp 10.000 di Rp 3,58 juta. Keduanya di bawah tiga bintang.

Tabel itu dihitung tanpa satu koin tip pun. Dengan semua koin terpungut, pemain yang tidak pernah mengubah apa pun rata-rata berakhir di Rp 1,41 juta dan yang paling beruntung di Rp 2,0 juta, masih jauh dari dua bintang; satu pegawai atau harga terlalu murah tetap bangkrut 100%; pemain cermat naik ke Rp 6,75 juta. Tip menghargai perhatian, tetapi tidak bisa menggantikan keputusan yang benar.

`npm run balance` mencetak seluruh hitungannya.

## Susunan folder

```
index.html            halaman tunggal, ikon SVG
styles/               tokens.css (warna, jarak), base.css, app.css
src/sim/              mesin discrete-event simulation
src/analytic/         rumus tunak dan penyelesai satu hari
src/game/             aturan permainan: ekonomi, kejadian, reputasi, penjelasan
src/ui/               tampilan: layar, animasi canvas, suara, tokoh
scripts/              penurunan angka keseimbangan, pencetak validasi, server lokal
tests/                tes (node --test)
```

Aturan permainan di `src/game/` tidak menyentuh browser sama sekali, jadi seluruhnya bisa diuji di Node.

## Teknologi

HTML, CSS, dan JavaScript murni (modul ES), tanpa framework. Animasi warung digambar di canvas dan digerakkan oleh mesin simulasinya sendiri. Grafik memakai Chart.js dari CDN, dengan tabel sebagai cadangan kalau CDN tidak terjangkau. Suara dibuat langsung dengan Web Audio API, tanpa file audio. Permainan disimpan di `localStorage`; kalau browser menolaknya, permainan tetap berjalan tanpa tersimpan.

Tampilan menghormati pengaturan "kurangi gerakan", bisa dipakai dengan keyboard, dan tiap grafik punya ringkasan teks serta tabel. Koin tip adalah tombol sungguhan yang diletakkan di atas kanvas, jadi bisa disentuh, dicapai dengan Tab, atau dipungut dengan tombol T.
