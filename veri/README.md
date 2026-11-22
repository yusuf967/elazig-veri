# Elazığ şehir uygulaması — veri katmanı

Sıfır bütçe, sunucu yok. İki yol var:

1. **Doğrudan API (uygulama çağırır):** anahtarsız, ücretsiz uçlar: Open-Meteo, Truncgil, AFAD.
2. **Kazıma + statik JSON:** `scripts/*.mjs` (Node 22, bağımlılık yok) GitHub Actions'ta zamanlanmış çalışır,
   `public/<ad>.json` üretir, iş akışı bunları `gh-pages` dalına iter → GitHub Pages:
   `https://<kullanici>.github.io/<depo>/<ad>.json`

Bütün uçlar ve betikler **21.11.2026'da canlı test edildi**, Elazığ verisi döndürdü.

```
veri/
  lib/ortak.mjs              indirme (zaman aşımı + sınırlı yeniden deneme), HTML temizleme, TR tarih, güvenli yazma,
                             A/B/C kaynak planı (planlarlaYaz)
  scripts/<ad>.mjs           her biri tek başına çalışır: node scripts/eczane.mjs
  run-all.mjs                hepsi / --grup sik|eczane|orta|seyrek / ad listesi; public/durum.json yazar
  public/                    üretilen JSON (git'e girmez, gh-pages'te yaşar)
```
İş akışı: depo kökünde `.github/workflows/veri.yml`.

**Haber yok:** haber sitelerinden hiçbir şey çekilmez (eski `haberler.json` kaldırıldı; iş akışı gh-pages'ten de siler).

## Siteleri zorlamama kuralları

- **User-Agent nötrdür:** `Mozilla/5.0 (compatible; veri-okuyucu/1.0)`. Uygulama ya da kişi adı içermez, gerçek bir tarayıcı
  dizisini taklit etmez (`VERI_UA` ile değiştirilebilir). MET Norway iletişim bilgisi istediği için yalnız ona
  `veri-okuyucu/1.0 github.com/elazig-veri` gönderilir (kişisel bilgi yok; `MET_UA` ile değiştirilebilir).
- **Engel aşma yok:** proxy, IP döndürme, captcha atlatma, tarayıcı taklidi yapılmaz.
- **Yeniden deneme:** yalnız ağ hatası/zaman aşımı/5xx'te **1 kez**. 403/404/429'da yeniden deneme yok; 403/429 veren sunucuya
  aynı çalıştırmada bir daha istek atılmaz, betik B planına geçer.
- **İstek sayısı:** her betik bir siteye çalıştırma başına 1-2 sayfa isteği atar. İstisna İŞKUR e-Şube: form sayfası +
  en fazla 3 sonuç sayfası, aralarında 1,5 sn. `run-all` betikler arasında 1 sn bekler.

## A / B / C planı

Her veri sırayla şu kaynaklardan denenir (`planlarlaYaz`): **A** asıl kaynak → **B** bağımsız yedek (varsa) →
**C** hiçbiri olmazsa önceki geçerli dosya olduğu gibi kalır ve üst alanlarına `durum: "eski"`, `sonBasari`, `sonDeneme` eklenir.
B kaynağı aynı şemaya (`ogeler` alanları) eşlenir; yedeğe özgü kısıtlar üst düzey `not` alanında yazar.

| Veri | A | B | Not |
|---|---|---|---|
| eczane | Elazığ Eczacı Odası | B: eczaneler.gen.tr "Sitene Ekle" iframe'i (tüm ilçeler + koordinat); B2: Elazığ Belediyesi /nobetci-eczaneler/ (yalnız Merkez, koordinatsız) | B/B2'de nöbet tarihi bugün/dün değilse liste reddedilir |
| deprem | AFAD | EMSC SeismicPortal FDSN (CC BY 4.0) | B'de yer = EMSC bölge adı ("EASTERN TURKEY"), il/ilce/mahalle null, id "EMSC-..." |
| piyasa | Truncgil v4 + v1 | Frankfurter (ECB referans kurları) | B yalnız USD/EUR/GBP; alis=null; altın yok |
| piyasa-gecmis | public/piyasa.json (+ uygulama ayarlarındaki ek fiyat verisi) her 30 dk | yok | 12 kalemin satış geçmişi `kalemler.<kod> = [[unixSn, satis]]`; son 2 gün 30 dk, 30 gün saatlik, 2 yıl günlük. Döviz bir kez Frankfurter ile 2 yıl geri doldurulur (`geriDoldurma.doviz`); altın zamanla birikir. piyasa.json taze değilse nokta eklenmez |
| is-ilanlari | İŞKUR e-Şube (en fazla 3 sayfa) | İŞKUR Açık İş Haritası (ilçe × meslek toplamları) | B tek tek ilan değil: ilanNo "H-<ilçe>-<meslek>" (gerçek no değil), sonBasvuru null |
| elektrik-kesintileri | Fırat EDAŞ | yok | Fırat EDAŞ'ın başka açık ucu yok; .xls robots.txt ile yasak; e-Devlet'te sorgusu yok |
| vefat | Elazığ Belediyesi | yok | Mezarlık Bilgi Sistemi oturumlu CBS uygulaması, liste değil (KVKK) |
| su-kesintileri | Belediye /haberler/ + /duyurular/ başlıkları | yok | |
| etkinlikler | Elazığ Belediyesi | yok | |
| yemekhane | unievi.firat.edu.tr | yok | sks.firat.edu.tr betiklere 403 veriyor (zorlanmadı) |
| hava | MET Norway | yok | MET düşerse C |
| elazigspor | TFF (lig, kulüp fikstür/kadro form gönderimi, oyuncu ve maç sayfaları) | Vikipedi (en) Sports table + "Current squad" — yalnız puan ve kadro | Bölümler bağımsız; okunamayan bölüm önceki dosyadan (`bolumler.<ad>.durum='eski'`). Önceki A verisi tazeyse (puan 3, kadro 14 gün) B yerine o tutulur. Oyuncu sayfaları 7 günde bir, oynanmış maç sayfaları bir kez okunur (`elazigspor-onbellek.json`). Mevki yalnız Vikipedi'den. Lig adındaki bahis sponsoru atılır. Görsel indirilmez. Günde 1 (`gunluk`, TR 06:30) |

Bilerek kullanılmayanlar: **Kandilli** ("yazılı izin ve onayı olmadan herhangi bir şekilde ticari amaçlı kullanılamaz"),
**e-Devlet nöbetçi eczane sorgusu** (jetonlu çok adımlı form; yasal bildirim içeriğin çoğaltılmasını yazılı izne bağlıyor),
**İl Sağlık Müdürlüğü** (nöbetçi eczane bağlantısı doğrudan eczacı odasına gidiyor, bağımsız değil), **haber siteleri** (sahibin kararı).

Ayrıştırıcı testleri (ağ yok): `npm test` (`test/ornekler` kayıtlarıyla). Elazığspor kuru çalıştırma: `node scripts/elazigspor.mjs --kuru`.

Test: `VERI_ATLA=A node scripts/eczane.mjs` A'yı hiç istek atmadan başarısız sayar ve B'yi dener;
`VERI_ATLA=A,B` B2'yi, tüm planları atlamak C'yi (önceki dosyanın `durum: "eski"` olmasını) dener.

## Güvenli yazma kuralı

`yaz()` önce doğrular, sonra `.tmp` dosyasına yazıp yeniden adlandırır. Şu durumlarda **yazmaz, önceki dosya kalır**:
öğe sayısı beklenen alt sınırın altındaysa, öğelerin %20'den fazlası doğrulamadan geçemiyorsa (site yapısı değişmiş demektir),
indirme/ayrıştırma hata verirse (o zaman sıradaki plan denenir). `run-all.mjs` her betiğin son başarı zamanını, kullanılan planı
ve son hatasını `public/durum.json`'a yazar. Uygulama bayatlığı her dosyadaki `durum`/`sonBasari` alanlarından gösterebilir.

## Ortak şekil

```ts
interface VeriDosyasi<T> {
  guncelleme: string;   // ISO 8601 (UTC), verinin üretildiği an (C planında değişmez)
  durum: 'guncel' | 'eski'; // 'eski' = son çalıştırmada hiçbir kaynak olmadı, bu önceki veridir -> "güncellenemedi, kaynağı aç"
  plan: 'A' | 'B';      // veriyi üreten kaynak planı (B = yedek kaynak)
  kaynak: string;       // kaynağın görünen adı (uygulamada gösterilmeli; B'de yedek kaynağın adı)
  kaynakUrl: string;    // kaynak sayfa
  sonBasari: string;    // son başarılı yazım (ISO UTC)
  sonDeneme?: string;   // yalnız durum='eski' iken: son başarısız deneme
  not?: string;         // bazı dosyalarda; B planında yedeğin kısıtlarını da anlatır
  ogeler: T[];
  // bazı dosyalarda ek üst alanlar var (aşağıda)
}
```

---

## 1. Uygulamanın DOĞRUDAN çağıracağı uçlar

### Hava durumu: Open-Meteo
```
GET https://api.open-meteo.com/v1/forecast?latitude=38.67&longitude=39.22
  &current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day
  &hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m
  &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,uv_index_max
  &timezone=Europe%2FIstanbul&forecast_days=7
```
Yanıt (sütun biçimi: her alan bir dizi, `time[i]` ile eşleşir; hourly 168, daily 7 öğe):
```json
{ "timezone": "Europe/Istanbul", "elevation": 1055,
  "current": { "time": "2026-11-21T17:45", "temperature_2m": 15.2, "relative_humidity_2m": 74, "apparent_temperature": 13.4,
               "precipitation": 0, "weather_code": 1, "wind_speed_10m": 13.1, "wind_direction_10m": 189, "is_day": 0 },
  "hourly": { "time": ["2026-11-21T00:00", ...], "temperature_2m": [13, ...], "precipitation_probability": [3, ...], ... },
  "daily":  { "time": ["2026-11-21", ...], "weather_code": [3, 61, ...], "temperature_2m_max": [17.5, ...],
              "temperature_2m_min": [11.9, ...], "sunrise": ["2026-11-21T07:11", ...], "uv_index_max": [2.75, ...] } }
```
`weather_code` = WMO kodu (0 açık, 1-3 parçalı/kapalı, 45/48 sis, 51-67 çisenti/yağmur, 71-77 kar, 80-82 sağanak, 95-99 fırtına).
CORS: `*`. **Risk:** Open-Meteo ücretsiz katmanı *ticari olmayan* kullanım içindir (günde 10.000 çağrı altı). Uygulama reklam/ücret
içerirse ticari sayılır, abonelik gerekir. Kaynak gösterimi zorunlu (CC BY 4.0): "Hava: Open-Meteo.com".

### Altın ve döviz: Truncgil Finans
```
GET https://finans.truncgil.com/v4/today.json?t=<Date.now()>
```
**`?t=` şart:** sunucu `Cache-Control: max-age=315360000` (10 yıl) gönderiyor; parametresiz istek önbellekte takılı kalır.
Sunucu dosyayı birkaç dakikada bir yeniliyor (`Last-Modified` 17:30, 17:33, 17:51 gözlendi). CORS: `*`.
```json
{ "Update_Date": "2026-11-21 17:33:01",
  "USD": { "Buying": 50.5643, "Selling": 50.5752, "Change": 0.22, "Type": "Currency" },
  "EUR": {...}, "GBP": {...},
  "GRA":              { "Buying": 5730.97, "Selling": 5731.95, "Change": -3.48, "Type": "Gold", "Name": "GRAMALTIN" },
  "CEYREKALTIN":      { "Buying": 9698,  "Selling": 9912,  ... },
  "YARIMALTIN":       { "Buying": 19379, "Selling": 19812, ... },
  "TAMALTIN":         { "Buying": 38633, "Selling": 39503, ... },
  "CUMHURIYETALTINI": { "Buying": 39685, "Selling": 40586, ... },
  "ONS":              { "Buying": 0, "Selling": 0, ... } }
```
**Dikkat:** v4'te `ONS` **0** geliyor. Ons için v1 kullanın: `GET https://finans.truncgil.com/today.json?t=...` →
`"ons": { "Alış": "$3.525,28", "Satış": "$3.525,91", "Değişim": "%-3,68", "Tür": "Altın" }` (Türkçe biçimli metin).
Kolaylık için `public/piyasa.json` ikisini birleştirip sayıya çevirir (aşağıda). Fiyatlar "serbest piyasa" gösterge fiyatıdır,
kuyumcu fiyatı farklı olabilir. **Risk:** Truncgil kullanım şartı yayınlamıyor, garanti yok; düşme ihtimaline karşı ayna var.

### Depremler: AFAD
```
GET https://servisnet.afad.gov.tr/apigateway/deprem/apiv2/event/filter
    ?start=2026-11-14T00:00:00&end=2026-11-21T23:59:59     (UTC, saniyeli, Z YOK)
    &lat=38.67&lon=39.22&maxrad=150000                      (metre)
    &orderby=timedesc                                       (timedesc | timeasc | magnitudedesc | magnitudeasc)
    [&limit=50] [&minmag=2]
```
`deprem.afad.gov.tr/apiv2/...` aynı yola 302 yönlendirir; doğrudan `servisnet` adresini kullanın.
```json
[{ "eventID": "734744", "date": "2026-11-21T05:53:08", "magnitude": "1.3", "type": "ML", "depth": "7",
   "latitude": "38.15717", "longitude": "38.47117", "location": "Battalgazi (Malatya)", "country": "Türkiye",
   "province": "Malatya", "district": "Battalgazi", "neighborhood": "Aksu", "rms": "0.18",
   "isEventUpdate": false, "lastUpdateDate": null }]
```
- Bütün sayılar **metin** gelir → `Number()`.
- `date` **UTC**'dir (EMSC ile aynı olayda karşılaştırıldı), sonunda `Z` yoktur → `new Date(date + 'Z')`.
- **Expo web / tarayıcıdan çağrılamaz:** CORS başlığı yok ve `Origin` başlıklı istekleri WAF "Request Rejected" HTML'i ile reddediyor.
  iOS/Android (React Native fetch) Origin göndermediği için çalışır. Web için `public/deprem.json` aynasını kullanın.
- **Risk:** kamu verisi, açık uç; aşırı sık çağırmayın (ekran açılışında + 5 dk'da bir yeter).

---

## 2. Kazınan / aynalanan veriler (`public/*.json`)

| Dosya | Kaynak (A) | Yöntem | Grup / sıklık (cron UTC; TR = UTC+3) |
|---|---|---|---|
| `deprem.json` | AFAD (ayna) | JSON | sik: 30 dk |
| `piyasa.json` | Truncgil (ayna) | JSON | sik: 30 dk |
| `hava.json` | MET Norway | JSON | sik: 30 dk |
| `eczane.json` | Elazığ Eczacı Odası | HTML | eczane: günde 3 (08:45, 18:15, 00:10 TR) |
| `elektrik-kesintileri.json` | Fırat EDAŞ | sitenin AJAX ucu (HTML satırları), 2 istek | orta: 3 saatte bir (`20 */3`) |
| `vefat.json` | Elazığ Belediyesi | HTML, 1 sayfa | seyrek: 6 saatte bir (`50 */6` → TR 03:50, 09:50, 15:50, 21:50) |
| `is-ilanlari.json` | İŞKUR e-Şube | ASP.NET postback (İl=23), en fazla 3 sayfa | seyrek |
| `etkinlikler.json` | Elazığ Belediyesi /etkinlikler/ | HTML, 1 sayfa | seyrek |
| `su-kesintileri.json` | Elazığ Belediyesi haber + duyuru listeleri | anahtar kelime süzgeci, 2 sayfa | seyrek |
| `yemekhane.json` | Fırat Üniversitesi SKS / unievi.firat.edu.tr | HTML, 1 sayfa | seyrek |
| `durum.json` | run-all | — | her çalıştırma |

### Şemalar (TypeScript)

```ts
// eczane.json — VeriDosyasi<Eczane> & { nobetGunu: string; not: string }
interface Eczane {
  ilce: string;          // "MERKEZ", "BASKİL", "KARAKOÇAN", "KEBAN", "KOVANCILAR", "PALU" ...
  ad: string;            // "DEVA ECZANESİ"
  adres: string;
  telefon: string | null; // yalnız rakam: "04242251212"
  lat: number | null;    // 38.668282
  lon: number | null;    // 39.238275
}
// nobetGunu: "2026-11-21" (TR tarihi). Nöbet: hafta içi 18:00→08:30, Cmt 13:00→Paz 08:30, Paz 08:30→Pzt 08:30.
// O gün nöbetçisi olmayan ilçeler listede çıkmaz.

// elektrik-kesintileri.json — VeriDosyasi<ElektrikKesintisi>
interface ElektrikKesintisi {
  ilce: string;              // "MERKEZ"
  tarih: string;             // "2026-11-29"
  baslangic: string;         // "09:00" (TR)
  bitis: string;             // "17:00"
  baslangicIso: string | null; // "2026-11-29T09:00:00+03:00"
  bitisIso: string | null;
  neden: string;             // "İşletme Bakım Çalışması (Ekip)"
  bolgeler: string[];        // ["ÇAĞLAR KÖYÜ ÇAĞLAR", "KORUCU KÖYÜ", ...] (aynı saat/nedenli satırlar birleşik)
  eklenme: string | null;    // "2026-11-20"
}
// Yalnız bugün ve sonrası; bu ay + gelecek ay sorgulanır.

// su-kesintileri.json — VeriDosyasi<SuDuyurusu> & { not: string }
interface SuDuyurusu {
  baslik: string;
  kaynak: string;      // "Elazığ Belediyesi"
  tarih: string;       // ISO
  baglanti: string;
}
// RESMÎ LİSTE DEĞİL: son 3 günde başlığında "su kesintisi / sular ... / isale hattı / arıza" geçen BELEDİYE haber/duyuruları.
// tarih: listedeki görselin yükleme zaman damgası (detay sayfası açılmaz), yoksa ilk görülme anı.
// Boş liste normaldir (21.11.2026'da 0).

// vefat.json — VeriDosyasi<Vefat>
interface Vefat {
  id: string | null;         // "34087" (belediyenin kayıt no'su)
  ad: string;                // "Nevriye TÜMAY"
  vefatTarihi: string | null; // "2026-11-21"
  cenazeSahibi?: string;     // "Mehmet TÜMAY (OĞLU)"
  definYeri?: string;        // "Asri Mez."
  taziye?: string;           // "Akpınar Muh. Taz. Evi"
  cenazeNamazi?: string;     // sayfada varsa
  diger?: Record<string, string>; // tanınmayan ek alanlar
}

// is-ilanlari.json — VeriDosyasi<IsIlani> & { toplamKayit: number | null; not: string }
interface IsIlani {
  ilanNo: string;            // "00009879264"
  meslek: string | null;     // "Kamyon Şoförü"
  pozisyonSayisi: number | null; // 5
  isverenTuru: string | null;  // "Özel" | "Kamu"
  calismaSekli: string | null; // "Tam Zamanlı"
  calismaYeri: string | null;  // "İlçe Geneli Başvuru (ELAZIĞ / ELAZIĞ MERKEZ)"
  sonBasvuru: string | null;   // "2026-11-24"
  baglanti: string;            // https://esube.iskur.gov.tr/Istihdam/AcikIsIlanDetay.aspx?uiID=...
}
// Son başvuru tarihine göre artan. Siteyi zorlamamak için en fazla 3 sayfa (~45 ilan) alınır; toplamKayit sitenin bildirdiği
// toplamdır (site en fazla 100 gösterir). İşyeri adı üyelik gerektirir, yok.
// B planında (Açık İş Haritası) öğeler ilçe × meslek toplamlarıdır: ilanNo "H-<ilçeKod>-<meslekNo>", sonBasvuru/isverenTuru/
// calismaSekli null, baglanti İŞKUR arama sayfası; pozisyonSayisi azalan.

// yemekhane.json — VeriDosyasi<MenuGunu>
interface MenuGunu {
  tarih: string;             // "2026-11-23"
  gun: string;               // "Pazartesi"
  yemekler: {
    tur: string | null;      // "Ana Yemek" | "Yardımcı Yemek" | "Eşlikçi" | "Tamamlayıcı"
    ad: string;              // "Etli Kuru Fasulye"
    kalori: number | null;   // 336
    protein: number | null;  // g
    karbonhidrat: number | null;
    yag: number | null;
  }[];
  toplamKalori: number | null;
}
// Hafta içi 5 gün (sayfa cumartesi günü bir sonraki haftayı gösteriyordu).

// etkinlikler.json — VeriDosyasi<Etkinlik> & { not: string }
interface Etkinlik {
  id: number;
  baslik: string;
  tarih: string | null;      // "2026-05-12"
  yer: string | null;        // "Bünyamin Eroğlu Kültür ve Kongre Salonu"
  kategoriler: string[];     // ["Konser"], ["Anma"], ["Tiyatro"] ...
  baglanti: string;
  gecmis: boolean | null;    // tarih bugünden önceyse true
}
// Belediye seyrek güncelliyor: 21.11.2026'da en yeni kayıt 12.05.2026, hepsi gecmis=true. Afiş görseli alınmaz.

// deprem.json — VeriDosyasi<Deprem> & { merkez: {lat:number; lon:number}; yaricapKm: number; gun: number }
interface Deprem {
  id: string;            // AFAD eventID
  tarih: string;         // "2026-11-21T05:53:08Z" (UTC)
  buyukluk: number;      // 1.3
  tip: string;           // "ML" | "Mw" ...
  derinlikKm: number;
  enlem: number;
  boylam: number;
  yer: string;           // "Battalgazi (Malatya)"
  il: string | null;
  ilce: string | null;
  mahalle: string | null;
  uzaklikKm: number;     // Elazığ merkezine (38.67, 39.22)
}
// Son 7 gün, 150 km, en yeni önce, en fazla 300. B (EMSC): id "EMSC-<unid>", yer bölge adı (İngilizce), il/ilce/mahalle null.

// piyasa.json — VeriDosyasi<PiyasaKalemi> & { kaynakGuncelleme: string | null }
interface PiyasaKalemi {
  kod: 'USD' | 'EUR' | 'GBP' | 'GRAM' | 'CEYREK' | 'YARIM' | 'TAM' | 'CUMHURIYET' | 'ONS' | 'GUMUS';
  ad: string;            // "Çeyrek Altın"
  tur: 'doviz' | 'altin' | 'gumus';
  birim: 'TRY' | 'USD';  // ONS USD'dir
  alis: number | null;
  satis: number;
  degisimYuzde: number | null; // -0.64
}
// B (Frankfurter/ECB): yalnız USD/EUR/GBP, alis=null, kaynakGuncelleme "YYYY-MM-DD" (ECB günü).

// durum.json
interface Durum {
  guncelleme: string;
  betikler: Record<string, {
    sonBasari?: string; ogeSayisi?: number | null; plan?: 'A' | 'B' | null; kaynak?: string | null; sureMs: number;
    sonHata: null | { zaman: string; mesaj: string };
  }>;
}
```

---

## 3. Kaynak notları ve hukuki risk

| Veri | robots.txt | Kullanım şartı / not | Risk |
|---|---|---|---|
| Eczane (elazigeczaciodasi.org.tr) | `/nobetci-eczaneler` serbest (yalnız /yonetim, /dosyalar, /eczaci, /telefon-rehberi yasak) | Kamu yararına yayınlanan nöbet listesi | Düşük. Kaynak gösterin, günde 3 istek |
| eczaneler.gen.tr (eczane B) | `/iframe.php` serbest (yalnız /cgi-bin, /cache, /parser, /images, /fonts yasak) | Kullanım koşulları "Sitene Ekle" uygulaması üzerinden verilerin paylaşılabileceğini, ücretsiz olduğunu söylüyor; kazıma yasağı yok | Düşük-orta. Yalnız A düşünce istek atılır; kaynak gösterin |
| EMSC SeismicPortal (deprem B) | — | Veri CC BY 4.0, ticari kullanım atıfla serbest ("EMSC-CSEM SeismicPortal, https://www.seismicportal.eu"). Eski bir EMSC sayfasında "ticari olmayan" ifadesi var; ticari yayında teyit önerilir | Düşük |
| Frankfurter / ECB (piyasa B) | — | Açık kaynak servis, ECB referans kurları; kaynak gösterin | Düşük |
| İŞKUR Açık İş Haritası (iş B) | robots.txt yok (404) | Kamu verisi, sitenin kendi JSON ucu (toplam sayılar) | Düşük |
| Fırat EDAŞ | yalnız .xls/.xlsx yasak | Kamuya duyuru amaçlı liste | Düşük |
| Belediye (vefat, etkinlik, duyuru, eczane B2) | yalnız /hata, /arama yasak | Sayfa altında genel telif uyarısı var; vefat bilgisi kamuya açık yayın | Vefat: **KVKK açısından orta** — yalnız güncel listeyi gösterin, arşivlemeyin, aranabilir kalıcı veritabanı yapmayın, kaldırma talebine hızlı yanıt verin. Etkinlik afişleri alınmadı |
| İŞKUR e-Şube | `Allow: /` | Üyeliksiz açık arama; işyeri adı gizli (almıyoruz) | Düşük-orta. 6 saatte bir, en fazla 3 sayfa, istekler arası 1,5 sn |
| Fırat Üni. menü (unievi.firat.edu.tr) | `Disallow:` boş (serbest) | — | Düşük |
| AFAD | — | Kamu verisi | Düşük |
| Truncgil | — | Şart yayınlanmamış, garanti yok | Düşük (fiyat verisi telif konusu değil), kaynak gösterin |
| Open-Meteo | — | CC BY 4.0, ticari olmayan ücretsiz | Uygulama gelir getirirse abonelik gerekir |

Genel: betikler nötr bir User-Agent kullanır (uygulama/kişi adı yok, tarayıcı taklidi yok), engelleme/kimlik doğrulama aşmaz.
Bir site erişimi kapatırsa (403/429) o çalıştırmada ona bir daha istek atılmaz, B planına geçilir; o da yoksa önceki dosya kalır (durum: "eski"). Zorlamayın.

## 4. Çalışmayanlar ve yedekler

| İhtiyaç | Durum | Uygulamadaki yedek |
|---|---|---|
| Su kesintisi (resmî liste) | Belediye yayınlamıyor: `/su-kesintileri/` 404, belediye RSS'i (`/rss/`) 500 hatası veriyor | `su-kesintileri.json` (belediye başlık süzgeci) + "Duyurular" bağlantısı `https://www.elazig.bel.tr/duyurular/` |
| ilan.gov.tr kamu ilanları | Sitenin API'si (`/api/api/services/app/...`) betiklere 403 dönüyor; aşmaya çalışmadık | Dış bağlantı `https://www.ilan.gov.tr/ilan/tum-ilanlar` (Angular uygulaması, il filtresi uygulama içinden seçilir) |
| İŞKUR il filtreli URL | Filtre yalnız form postback'iyle çalışıyor, URL parametresi yok | `is-ilanlari.json` + dış bağlantı `https://esube.iskur.gov.tr/Istihdam/AcikIsIlanAra.aspx` |
| Sinema/tiyatro seansları | Ücretsiz/açık kaynak bulunamadı | Belediye etkinlikleri (`etkinlikler.json`), kategori "Sinema"/"Tiyatro" |
| Güncel etkinlik | Belediye bölümü 6 aydır güncellenmemiş | Belediye haberleri `https://www.elazig.bel.tr/haberler/` (fuar vb. orada duyuruluyor) |
| AFAD (web) | CORS/WAF | `deprem.json`; dış bağlantı `https://deprem.afad.gov.tr/last-earthquakes` |

## Gizli ayarlar (Actions secrets)

Bazı betikler adres ve ayarlarını koddan değil, depo ayarlarındaki gizli değişkenlerden okur:
`SUPABASE_URL`, `SUPABASE_KEY` (yönetici paneli ayarlarını okumak için, herkese açık anahtar).
Tanımlı değilse ilgili betik atlanır, önceki dosya korunur.

## Yerelde çalıştırma

```bash
cd veri
node run-all.mjs                  # hepsi (~30 sn)
node run-all.mjs --grup sik       # sik | eczane | orta | seyrek
VERI_ATLA=A node scripts/deprem.mjs   # B planını dene (A'ya istek atılmaz)
node scripts/eczane.mjs           # tek betik
```
