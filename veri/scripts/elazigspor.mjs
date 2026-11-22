// Elazığspor: puan durumu, fikstür/sonuçlar, kadro ve oyuncu ayrıntıları. Günde 1 kez çalışır (grup "gunluk").
//
// Bölümler birbirinden bağımsız denenir; biri düşerse diğerleri yine güncellenir:
//  A: TFF (tff.org, kamuya açık sayfalar; yurt dışından da açılıyor — 22.11.2026'da denendi):
//     - lig sayfası (pageID=976)       -> puan cetveli (Elazığspor'un grubu), sezon
//     - kulüp sayfası (pageID=28)      -> fikstür (sayfalı tablo, ASP.NET form gönderimi) ve kadro (Profesyonel, Faal)
//     - oyuncu sayfası (pageId=30)     -> doğum tarihi/yeri, uyruk. 7 günde bir yenilenir (önbellek)
//     - maç sayfası (pageID=29)        -> ilk 11/yedek/giren/gol/kart, forma numarası, stat, saat.
//                                         Oynanmış maç değişmez: bir kez okunur, önbellekte kalır.
//                                         Ayrıca maç olayları (olaylar: gol/kart dakikaları, adlı kadrolar,
//                                         oyuncu değişiklikleri, hakem) fikstürdeki oynanmış maça eklenir.
//                                         Olaysız eski önbellek kaydı bir kez yeniden okunur (geri doldurma).
//  Yayın: resmi yayıncının (Tivibu) "TFF 2. Lig Maçları Hangi Kanalda?" tablosu (tarih, ev, deplasman, kanal).
//         Yalnız oynanmamış maça `yayin` eklenir; tablo okunamazsa önbellekteki kanal kullanılır, yoksa alan hiç yok.
//         TFF maç/fikstür sayfalarında yayıncı bilgisi yok (22.11.2026'da bakıldı).
//  B: Vikipedi (en.wikipedia.org, MediaWiki API, yurt dışından açık) — yalnız puan durumu ve kadro için:
//     "2026–27 TFF 2. Lig" Sports table modülü (gönüllülerce güncellenir, birkaç gün geride olabilir) ve
//     "Elazığspor" maddesinin "Current squad" listesi. Fikstür için bağımsız bir yedek yok.
//     Vikipedi kadrosu A'da da yalnız MEVKİ için kullanılır (TFF mevki yayınlamıyor); eşleşmeyen oyuncunun mevkisi null.
//  C: Okunamayan bölüm önceki dosyadan aynen alınır ve bolumler.<ad>.durum = 'eski' olur.
//     Hiçbir bölüm okunamazsa önceki dosya korunur, durum:'eski'.
//
// Nezaket: istekler arası 1,5 sn; oyuncu ve maç sayfaları önbellekli (ilk çalıştırmada ~45, sonraki günlerde ~8-12 istek).
// Görsel (oyuncu fotoğrafı, logo) İNDİRİLMEZ. Lig adındaki bahis sponsoru adı atılır ("Nesine 2. Lig" -> "2. Lig").
//
// Kuru çalıştırma (dosya yazmaz, özet basar): node scripts/elazigspor.mjs --kuru
// Plan testi: VERI_ATLA=A node scripts/elazigspor.mjs --kuru  (B),  VERI_ATLA=A,B ... (C)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getir, bekle, temizle, varlikCoz, trTarihMetin, noktaliTarih, bugunTR, baslikHarfi,
  oncekiniOku, dosyaYaz, PUBLIC, calistir,
} from '../lib/ortak.mjs';

export const AD = 'elazigspor';
const ONBELLEK = 'elazigspor-onbellek';
const TFF = 'https://www.tff.org/Default.aspx';
const KULUP_ID = '37';
const LIG_URL = `${TFF}?pageID=976`;
const KULUP_URL = `${TFF}?pageID=28&kulupID=${KULUP_ID}`;
const oyuncuUrl = (id) => `${TFF}?pageId=30&kisiId=${id}`;
const macUrl = (id) => `${TFF}?pageID=29&macID=${id}`;
const YAYIN_URL = 'https://www.tivibu.com.tr/tff-ikinci-lig';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const WIKI_KULUP = 'Elazığspor';
const KURU = process.argv.includes('--kuru');

const ARA_MS = 1500;
const OYUNCU_YENILE_GUN = 7;
const EN_FAZLA_OYUNCU = 30; // bir çalıştırmada en fazla bu kadar oyuncu sayfası
const EN_FAZLA_MAC = 20; // bir çalıştırmada en fazla bu kadar yeni maç sayfası
const EN_FAZLA_BAYT = 250_000; // elazigspor.json bunu aşarsa eski maçların adlı kadroları atılır
const KADRO_TUT_GUN = 42; // ... son 6 haftanınkiler kalır

// ---------------------------------------------------------------- yardımcılar

const BAHIS = /\b(nesine|bilyoner|misli|iddaa|tuttur|birebin|oley)\b\.?(com)?/giu;

/** Lig/turnuva adından bahis sponsorunu atar: "Nesine 2. Lig Beyaz" -> "2. Lig Beyaz" */
export function bahissiz(s = '') {
  return s.replace(BAHIS, '').replace(/\s+/g, ' ').trim();
}

/** "SEZA ÇİMENTO ELAZIĞSPOR" -> "Elazığspor"; "MUŞ SPOR KULÜBÜ" -> "Muş Spor"; "ALİAĞA FUTBOL A.Ş." -> "Aliağa" */
export function takimAdi(ham = '', biz = false) {
  if (biz) return 'Elazığspor';
  let s = baslikHarfi(temizle(ham));
  s = s.replace(/\s+A\.?ş\.?$/iu, '')
    .replace(/\s+Futbol\s+(Sk|Kulübü|Yatırımları)$/iu, '')
    .replace(/\s+Futbol$/iu, '')
    .replace(/\s+Spor\s+Kulübü$/iu, ' Spor')
    .replace(/\s+Futbol\s+Kulübü\s+Sk$/iu, '')
    .replace(/\s+Kulübü$/iu, '');
  return s.trim();
}

const sayi = (s) => {
  const n = Number(String(s ?? '').replace(/[^\d-]/g, ''));
  return Number.isFinite(n) && String(s ?? '').match(/\d/) ? n : null;
};

/** Windows-1254 form kodlaması (TFF formu bu kodlamayı bekler). */
const TR1254 = { Ç: 0xc7, ç: 0xe7, Ğ: 0xd0, ğ: 0xf0, İ: 0xdd, ı: 0xfd, Ö: 0xd6, ö: 0xf6, Ş: 0xde, ş: 0xfe, Ü: 0xdc, ü: 0xfc };
export function formKodla(s = '') {
  let o = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (/[A-Za-z0-9_.\-*]/.test(ch)) o += ch;
    else if (ch === ' ') o += '+';
    else if (TR1254[ch]) o += '%' + TR1254[ch].toString(16).toUpperCase();
    else if (c < 256) o += '%' + c.toString(16).toUpperCase().padStart(2, '0');
    else o += encodeURIComponent(ch);
  }
  return o;
}

/** Sayfadaki gizli ve metin <input>'larını (ASP.NET form durumu) toplar. */
export function formAlanlari(html) {
  const alanlar = [];
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const etiket = m[0];
    const tur = (etiket.match(/\btype="([^"]+)"/i)?.[1] || '').toLowerCase();
    if (tur !== 'hidden' && tur !== 'text') continue;
    const ad = etiket.match(/\bname="([^"]+)"/i)?.[1];
    if (!ad) continue;
    alanlar.push([varlikCoz(ad), varlikCoz(etiket.match(/\bvalue="([^"]*)"/i)?.[1] ?? '')]);
  }
  return alanlar;
}

function formGovdesi(alanlar, ek = {}) {
  const harita = new Map(alanlar);
  for (const [k, v] of Object.entries(ek)) harita.set(k, v);
  return [...harita].map(([k, v]) => `${formKodla(k)}=${formKodla(v)}`).join('&');
}

// ---------------------------------------------------------------- TFF ayrıştırıcıları (saf fonksiyonlar, testli)

/** Lig sayfası: { sezon, puanDurumu[] }. Elazığspor satırı biz:true. Bulunamazsa biz satırı yok demektir. */
export function puanCoz(html) {
  const sezon = temizle(html).match(/(\d{4}-\d{4}) Sezonu Puan Cetveli/)?.[1] || null;
  const satirlar = [];
  for (const parca of html.split(/<tr\b/i).slice(1)) {
    const t = parca.match(/grvACetvel_ctl\d+_lnkTakim"[^>]*href="[^"]*kulupI[dD]=(\d+)"[^>]*>([^<]+)<\/a>/);
    if (!t) continue;
    const ad = temizle(t[2]);
    const sira = sayi(ad.match(/^(\d+)\./)?.[1]);
    const degerler = [...parca.matchAll(/grvACetvel_ctl\d+_(lblOyun|Label4|lblKazanma|lblPuan|Label1|Label2|Label5|Label3)"[^>]*>([^<]*)</g)]
      .reduce((o, m) => ({ ...o, [m[1]]: sayi(m[2]) }), {});
    const biz = t[1] === KULUP_ID;
    satirlar.push({
      sira,
      takim: takimAdi(ad.replace(/^\d+\./, ''), biz),
      o: degerler.lblOyun, g: degerler.Label4, b: degerler.lblKazanma, m: degerler.lblPuan,
      a: degerler.Label1, y: degerler.Label2, av: degerler.Label5, p: degerler.Label3,
      ...(biz ? { biz: true } : {}),
    });
  }
  // Ceza puanları ("Ceza Puanı Alan Takımlar" tablosu) — bilgi notu olarak
  const ceza = [];
  const ci = html.indexOf('Ceza Puan');
  if (ci >= 0) {
    const blok = temizle(html.slice(ci, ci + 6000)).split('Not:')[0];
    for (const m of blok.matchAll(/([A-ZÇĞİÖŞÜ0-9][A-ZÇĞİÖŞÜ0-9 .&'-]+?)\s+(\d{1,3})(?=\s|$)/g)) {
      if (/CEZA PUAN|TAKIM ADI/i.test(m[1])) continue;
      ceza.push({ takim: takimAdi(m[1]), puan: Number(m[2]) });
    }
  }
  return { sezon, puanDurumu: satirlar, ceza };
}

export const puanSatiriGecerli = (s) =>
  s && s.takim && Number.isFinite(s.sira) && ['o', 'g', 'b', 'm', 'a', 'y', 'av', 'p'].every((k) => Number.isFinite(s[k]));

/** Kulüp fikstür tablosu (bir sayfa): { maclar[], sonrakiHedef } — sonrakiHedef "Sonraki sayfa" postback hedefi. */
export function fiksturCoz(html) {
  const maclar = [];
  const ti = html.indexOf('grdFikstur_ctl01');
  if (ti < 0) return { maclar, sonrakiHedef: null };
  const tablo = html.slice(ti, html.indexOf('</table>', html.indexOf('<tbody', ti)) + 8);
  for (const parca of tablo.split(/<tr\b/i).slice(1)) {
    const hucreler = [...parca.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (hucreler.length < 6) continue;
    const evId = hucreler[1].match(/kulupI[dD]=(\d+)/)?.[1];
    const depId = hucreler[3].match(/kulupI[dD]=(\d+)/)?.[1];
    // Tarihi henüz açıklanmamış maçta tarih hücresi boştur (tarih: null; hafta ve macId vardır).
    const tarih = trTarihMetin(temizle(hucreler[4])) || noktaliTarih(temizle(hucreler[4])) || null;
    if (evId !== KULUP_ID && depId !== KULUP_ID) continue;
    if (!tarih && !hucreler[2].match(/macI[dD]=/)) continue;
    const skorMetin = temizle(hucreler[2]);
    const sk = skorMetin.match(/^(\d+)\s*-\s*(\d+)/);
    maclar.push({
      macId: hucreler[2].match(/macI[dD]=(\d+)/)?.[1] || null,
      hafta: sayi(temizle(hucreler[0])),
      tarih,
      evSahibi: takimAdi(hucreler[1], evId === KULUP_ID),
      deplasman: takimAdi(hucreler[3], depId === KULUP_ID),
      ev: evId === KULUP_ID,
      skor: sk ? `${sk[1]}-${sk[2]}` : null,
      evGol: sk ? Number(sk[1]) : null,
      depGol: sk ? Number(sk[2]) : null,
      turnuva: bahissiz(temizle(hucreler[5])) || null,
    });
  }
  const sonraki = tablo.match(/__doPostBack\(&#39;([^&]+)&#39;,&#39;&#39;\)"\s*>\)?\s*Sonraki/) ||
    tablo.match(/title="Next page" href="javascript:__doPostBack\(&#39;([^&]+)&#39;/);
  return { maclar, sonrakiHedef: sonraki ? varlikCoz(sonraki[1]) : null };
}

/** Tarihli maçlar tarih sırasıyla, tarihi açıklanmamışlar sonda hafta sırasıyla. */
export function fiksturSirala(maclar) {
  return [...maclar].sort((a, b) => {
    if (a.tarih && b.tarih) return a.tarih.localeCompare(b.tarih) || (a.hafta ?? 0) - (b.hafta ?? 0);
    if (a.tarih) return -1;
    if (b.tarih) return 1;
    return (a.hafta ?? 99) - (b.hafta ?? 99);
  });
}

/** Kadro tablosu: [{ id, adHam, kiralik }] */
export function kadroCoz(html) {
  const liste = [];
  const gorulen = new Set();
  for (const m of html.matchAll(/grdKadro_ctl01_ctl\d+_lnkOyuncu" href="[^"]*kisiI[dD]=(\d+)"[^>]*>([^<]+)<\/a>\s*<span[^>]*_k">([^<]*)<\/span>/g)) {
    if (gorulen.has(m[1])) continue;
    gorulen.add(m[1]);
    const k = temizle(m[3]).match(/Kiralık geldiği takım:\s*([^)]+)/i);
    liste.push({ id: m[1], ad: baslikHarfi(temizle(m[2])), ...(k ? { kiralik: takimAdi(k[1]) } : {}) });
  }
  return liste;
}

const UYRUK = { TC: 'Türkiye', 'T.C.': 'Türkiye', TÜRKİYE: 'Türkiye' };

/** Oyuncu sayfası: { dogum, dogumYeri, uyruk } */
export function oyuncuCoz(html) {
  const t = temizle(html);
  const alan = (etiket, sonraki) => {
    const m = t.match(new RegExp(`${etiket}\\s*:\\s*(.*?)\\s*(?:${sonraki})`));
    return m ? m[1].trim() : '';
  };
  const dogumYeri = alan('Doğum Yeri', 'Doğum Tarihi');
  const dogum = trTarihMetin(alan('Doğum Tarihi', 'Uyruk')) || noktaliTarih(alan('Doğum Tarihi', 'Uyruk'));
  const uyrukHam = alan('Uyruk', 'Futbolcu Menajeri|Lisans Bilgileri');
  return {
    dogum: dogum || null,
    dogumYeri: dogumYeri ? baslikHarfi(dogumYeri) : null,
    uyruk: uyrukHam ? (UYRUK[uyrukHam.toLocaleUpperCase('tr-TR')] || baslikHarfi(uyrukHam)) : null,
  };
}

/** Maç sayfası: { tarih, saat, stat, ev:{kulupId, ...}, dep:{...} } — her takım için oyuncu listeleri. */
export function macCoz(html) {
  const tarihSaat = html.match(/dtMacBilgisi_lblTarih"[^>]*>([^<]*)</)?.[1] || '';
  const statHam = html.match(/dtMacBilgisi_lnkStad"[^>]*>([^<]*)</)?.[1] || '';
  const takimId = (n) => html.match(new RegExp(`dtMacBilgisi_lnkTakim${n}"[^>]*kulupI[dD]=(\\d+)`))?.[1] || null;
  const takim = (n) => {
    const kim = (rpt, alan) => [...html.matchAll(new RegExp(`grdTakim${n}_${rpt}_ctl\\d+_${alan}"[^>]*kisiI[dD]=(\\d+)"[^>]*>([^<]*)<`, 'g'))]
      .map((m) => ({ id: m[1], metin: temizle(m[2]) }));
    const numarali = (rpt) => [...html.matchAll(new RegExp(`grdTakim${n}_${rpt}_ctl\\d+_formaNo"[^>]*>([^<]*)</span>\\s*<a[^>]*kisiI[dD]=(\\d+)"`, 'g'))]
      .map((m) => ({ id: m[2], numara: sayi(m[1]) }));
    const kartlar = [...html.matchAll(new RegExp(`grdTakim${n}_rptKartlar_ctl\\d+_k" src="([^"]*)"[\\s\\S]*?kisiI[dD]=(\\d+)`, 'g'))]
      .map((m) => ({ id: m[2], kirmizi: /kirmizi/i.test(m[1]) }));
    return {
      kulupId: takimId(n),
      ilk11: numarali('rptKadrolar'),
      yedek: numarali('rptYedekler'),
      girenler: kim('rptGirenler', 'lblGiren').map((x) => x.id),
      goller: kim('rptGoller', 'lblGol').map((x) => ({ id: x.id, kk: /\(K\)/.test(x.metin) })),
      kartlar,
    };
  };
  const stat = statHam.split(' - ')[0].trim();
  return {
    tarih: noktaliTarih(tarihSaat),
    saat: tarihSaat.match(/(\d{1,2}:\d{2})/)?.[1] || null,
    stat: stat ? baslikHarfi(stat) : null,
    ev: takim(1),
    dep: takim(2),
  };
}

/** Maç önbelleğinden oyuncu başına sezon istatistiği: { [id]: {mac, ilk11, gol, sari, kirmizi, numara, numaraTarih} } */
export function istatistikTopla(maclar) {
  const ist = {};
  const al = (id) => (ist[id] ||= { mac: 0, ilk11: 0, gol: 0, sari: 0, kirmizi: 0, numara: null, numaraTarih: '' });
  for (const mac of maclar) {
    const biz = mac.ev?.kulupId === KULUP_ID ? mac.ev : mac.dep?.kulupId === KULUP_ID ? mac.dep : null;
    if (!biz) continue;
    for (const o of biz.ilk11) { const s = al(o.id); s.mac++; s.ilk11++; }
    for (const id of biz.girenler) al(id).mac++;
    for (const o of [...biz.ilk11, ...biz.yedek]) {
      const s = al(o.id);
      if (o.numara != null && (mac.tarih || '') >= s.numaraTarih) { s.numara = o.numara; s.numaraTarih = mac.tarih || ''; }
    }
    for (const g of biz.goller) if (!g.kk) al(g.id).gol++;
    for (const k of biz.kartlar) { const s = al(k.id); if (k.kirmizi) s.kirmizi++; else s.sari++; }
  }
  return ist;
}

/** "90+2.dk" -> { dk: 90, ek: 2 };  "13.dk" -> { dk: 13 } */
export function dakikaCoz(s = '') {
  const m = String(s).match(/(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
  if (!m) return { dk: null };
  return { dk: Number(m[1]), ...(m[2] ? { ek: Number(m[2]) } : {}) };
}

const dkSira = (o) => (o.dk ?? 999) + (o.ek ?? 0) / 100;
const GOL_TUR = { P: 'penalti', K: 'kk' }; // TFF: (P) penaltı, (K) kendi kalesine; (F)/(H) atılır (anlamı yayımlanmıyor)

/**
 * Maç sayfasından olaylar: { goller[], kartlar[], kadrolar:{ev,dep}, degisiklikler[], hakem }.
 * Oyuncu kimliği (id) yalnız Elazığspor tarafında tutulur (uygulama oyuncu sayfasına bağlar).
 * Rakip kendi kalesine gol: TFF golü, golün yazıldığı takım bölümünde verir; `takim` o bölümdür.
 */
export function olaylarCoz(html) {
  const ad = (s) => baslikHarfi(temizle(s));
  const takimId = (n) => html.match(new RegExp(`dtMacBilgisi_lnkTakim${n}"[^>]*kulupI[dD]=(\\d+)`))?.[1] || null;
  const goller = [], kartlar = [], degisiklikler = [], kadrolar = {};
  for (const [n, takim] of [[1, 'ev'], [2, 'dep']]) {
    const biz = takimId(n) === KULUP_ID;
    const kimlik = (id) => (biz ? { id } : {});
    const oyuncular = (rpt) => [...html.matchAll(new RegExp(
      `grdTakim${n}_${rpt}_ctl\\d+_formaNo"[^>]*>([^<]*)</span>\\s*<a[^>]*kisiI[dD]=(\\d+)"[^>]*>([^<]*)<`, 'g'))]
      .map((m) => ({ no: sayi(m[1]), ad: ad(m[3]), ...kimlik(m[2]) }));
    kadrolar[takim] = { ilk11: oyuncular('rptKadrolar'), yedek: oyuncular('rptYedekler') };

    for (const m of html.matchAll(new RegExp(`grdTakim${n}_rptGoller_ctl\\d+_lblGol"[^>]*kisiI[dD]=(\\d+)"[^>]*>([^<]*)<`, 'g'))) {
      const metin = temizle(m[2]);
      const virgul = metin.lastIndexOf(',');
      const tur = GOL_TUR[metin.match(/\(([A-ZÇĞİÖŞÜ])\)\s*$/)?.[1]];
      goller.push({
        ...dakikaCoz(virgul >= 0 ? metin.slice(virgul + 1) : ''),
        oyuncu: ad(virgul >= 0 ? metin.slice(0, virgul) : metin), takim, ...kimlik(m[1]), ...(tur ? { tur } : {}),
      });
    }
    for (const m of html.matchAll(new RegExp(
      `grdTakim${n}_rptKartlar_ctl\\d+_k" src="([^"]*)"(?:\\s+alt="([^"]*)")?[^>]*>[\\s\\S]{0,40}?<a[^>]*kisiI[dD]=(\\d+)"[^>]*>([^<]*)</a>\\s*<span[^>]*_d">([^<]*)<`, 'g'))) {
      const iz = `${m[1]} ${m[2] || ''}`;
      const renk = /sarikirmizi|çift sarı/i.test(iz) ? 'sari-kirmizi' : /kirmizi|kırmızı/i.test(iz) ? 'kirmizi' : 'sari';
      kartlar.push({ ...dakikaCoz(m[5]), oyuncu: ad(m[4]), takim, renk, ...kimlik(m[3]) });
    }
    const degisen = (rpt, alan, dkAlan) => [...html.matchAll(new RegExp(
      `grdTakim${n}_${rpt}_ctl\\d+_${alan}"[^>]*kisiI[dD]=(\\d+)"[^>]*>([^<]*)</a>(?:&nbsp;|\\s)*<span[^>]*_${dkAlan}">([^<]*)<`, 'g'))]
      .map((m) => ({ ...dakikaCoz(m[3]), ad: ad(m[2]), id: m[1] }));
    const girenler = degisen('rptGirenler', 'lblGiren', 'og');
    const cikanlar = degisen('rptCikanlar', 'lblCikan', 'oc');
    const kullanildi = new Set();
    girenler.forEach((g, i) => {
      // Aynı dakikadaki çıkanla eşle; bulunamazsa sıradaki kullanılmamış çıkan.
      let j = cikanlar.findIndex((c, k) => !kullanildi.has(k) && c.dk === g.dk && c.ek === g.ek);
      if (j < 0) j = cikanlar.findIndex((_, k) => !kullanildi.has(k) && k >= i);
      if (j >= 0) kullanildi.add(j);
      const c = j >= 0 ? cikanlar[j] : null;
      degisiklikler.push({
        dk: g.dk, ...(g.ek ? { ek: g.ek } : {}), takim,
        giren: g.ad, ...(biz ? { girenId: g.id } : {}),
        ...(c ? { cikan: c.ad, ...(biz ? { cikanId: c.id } : {}) } : {}),
      });
    });
  }
  const sirala = (l) => l.sort((a, b) => dkSira(a) - dkSira(b));
  const hakem = html.match(/dtMacBilgisi_rpt_ctl\d+_lnkHakem"[^>]*>([^<(]*)\(Hakem\)</)?.[1];
  return {
    goller: sirala(goller),
    kartlar: sirala(kartlar),
    kadrolar,
    degisiklikler: sirala(degisiklikler),
    ...(hakem && temizle(hakem) ? { hakem: ad(hakem) } : {}),
  };
}

/** Olaylar geçerli mi: iki tarafın da ilk 11'i okunmuş olmalı. */
export const olaylarGecerli = (o) => !!o && o.kadrolar?.ev?.ilk11?.length >= 7 && o.kadrolar?.dep?.ilk11?.length >= 7;

/**
 * Yayıncı tablosu ("TFF 2. Lig Maçları Hangi Kanalda?"): [{ tarih, saat, ev, dep, kanal }].
 * Satırlar <time datetime="YYYY-MM-DD"> içerir; kanal düz metindir (ör. "Tivibu Spor 1", "Yaay").
 */
const HTML_TR = { Ccedil: 'Ç', ccedil: 'ç', Ouml: 'Ö', ouml: 'ö', Uuml: 'Ü', uuml: 'ü', Iuml: 'Ï', iuml: 'ï' };
const metinTR = (s) => temizle(s.replace(/&(Ccedil|ccedil|Ouml|ouml|Uuml|uuml|Iuml|iuml);/g, (_, k) => HTML_TR[k]));

export function yayinCoz(html = '') {
  const temizle = metinTR; // bu sayfa Türkçe harfleri adlı HTML varlığı olarak yazıyor (&Ccedil; &uuml;)
  const satirlar = [];
  for (const parca of html.split(/<tr\b/i).slice(1)) {
    const hucreler = [...parca.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (hucreler.length < 5) continue;
    const tarih = hucreler[0].match(/datetime="(\d{4}-\d{2}-\d{2})"/)?.[1];
    const kanal = temizle(hucreler[4]);
    if (!tarih || !kanal || kanal.length > 40 || /</.test(kanal)) continue;
    satirlar.push({
      tarih,
      saat: hucreler[1].match(/datetime="(\d{1,2}:\d{2})"/)?.[1] || temizle(hucreler[1]).match(/\d{1,2}:\d{2}/)?.[0] || null,
      ev: temizle(hucreler[2]),
      dep: temizle(hucreler[3]),
      kanal,
    });
  }
  return satirlar;
}

/** Yayın tablosunda fikstürdeki maçın kanalı: aynı tarih + Elazığspor tarafı + (varsa) rakip adının bir parçası. */
export function yayinBul(mac, satirlar) {
  if (!mac?.tarih) return null;
  const elazig = (s) => sadelestir(s).some((p) => p.startsWith('elazig'));
  const rakip = sadelestir(mac.ev ? mac.deplasman : mac.evSahibi).filter((p) => p.length >= 4 && p !== 'spor');
  const aday = satirlar.filter((s) => s.tarih === mac.tarih && (mac.ev ? elazig(s.ev) : elazig(s.dep)));
  const tam = aday.find((s) => {
    const k = sadelestir(mac.ev ? s.dep : s.ev);
    return !rakip.length || rakip.some((p) => k.some((x) => x.startsWith(p.slice(0, 5))));
  });
  return (tam || (aday.length === 1 ? aday[0] : null))?.kanal || null;
}

/**
 * JSON boyutu sınırı aşılırsa eski maçların adlı kadrolarını atar (gol/kart/değişiklik kalır).
 * Fikstürü yerinde değiştirir; atılan maç sayısını döndürür.
 */
export function kadroBoyutla(fikstur, bugun, enFazla = EN_FAZLA_BAYT, tutGun = KADRO_TUT_GUN) {
  if (JSON.stringify(fikstur).length <= enFazla) return 0;
  const sinir = new Date(new Date(`${bugun}T00:00:00Z`).getTime() - tutGun * 86400e3).toISOString().slice(0, 10);
  let atilan = 0;
  for (const m of fikstur) {
    if (m.olaylar?.kadrolar && m.tarih && m.tarih < sinir) { delete m.olaylar.kadrolar; atilan++; }
  }
  return atilan;
}

// ---------------------------------------------------------------- Vikipedi ayrıştırıcıları (B ve mevki)

const MEVKI = { GK: 'Kaleci', DF: 'Defans', MF: 'Orta saha', FW: 'Forvet' };
const ULKE = {
  TUR: 'Türkiye', AZE: 'Azerbaycan', GER: 'Almanya', NED: 'Hollanda', BEL: 'Belçika', FRA: 'Fransa', AUT: 'Avusturya',
  BIH: 'Bosna-Hersek', GEO: 'Gürcistan', KOS: 'Kosova', MKD: 'Kuzey Makedonya', SRB: 'Sırbistan', NGA: 'Nijerya',
  SEN: 'Senegal', GHA: 'Gana', CMR: 'Kamerun', CIV: 'Fildişi Sahili', BRA: 'Brezilya', ALB: 'Arnavutluk', IRQ: 'Irak',
};

const wikiBag = (s = '') => s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{[^}]*\}\}/g, '').trim();

/** "Current squad" bölümündeki {{Fs player|no=|pos=|nat=|name=}} satırları (Out on loan hariç). */
export function wikiKadroCoz(wikitext = '') {
  const bas = wikitext.search(/==\s*Current squad\s*==/i);
  if (bas < 0) return { kadro: [], guncel: null };
  const son = wikitext.slice(bas + 5).search(/\n==[^=]|\n===\s*Out on loan/i);
  const blok = wikitext.slice(bas, son < 0 ? undefined : bas + 5 + son);
  const guncel = blok.match(/\{\{updated\|([^|}<]+)/i)?.[1]?.trim() || null;
  const kadro = [];
  for (const m of blok.matchAll(/\{\{\s*Fs player\s*\|([^\n]*)\}\}/gi)) {
    const p = {};
    for (const kv of m[1].split('|')) { const i = kv.indexOf('='); if (i > 0) p[kv.slice(0, i).trim().toLowerCase()] = kv.slice(i + 1).trim(); }
    const ad = wikiBag(p.name || '');
    if (!ad) continue;
    kadro.push({ ad, numara: sayi(p.no), mevki: MEVKI[(p.pos || '').toUpperCase()] || null, uyruk: ULKE[(p.nat || '').toUpperCase()] || p.nat || null });
  }
  return { kadro, guncel };
}

/** Sports table modülünden Elazığspor'un grubu: { puanDurumu[], guncel, grup } */
export function wikiPuanCoz(wikitext = '') {
  const tablolar = wikitext.split(/\{\{#invoke:Sports table\|main/i).slice(1).map((t) => t.split('</onlyinclude>')[0]);
  const tablo = tablolar.find((t) => /\|\s*name_\w+\s*=\s*\[\[Elazığspor/.test(t));
  if (!tablo) return { puanDurumu: [], guncel: null, grup: null };
  const deger = (k) => tablo.match(new RegExp(`\\|\\s*${k}\\s*=\\s*([^|\\n]*)`))?.[1]?.trim();
  const sira = (deger('team_order') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const satirlar = sira.map((kod) => {
    const n = (k) => Number(deger(`${k}_${kod}`) || 0);
    const g = n('win'), b = n('draw'), m = n('loss'), a = n('gf'), y = n('ga');
    const ad = wikiBag(deger(`name_${kod}`) || kod);
    return { takim: ad, o: g + b + m, g, b, m, a, y, av: a - y, p: g * 3 + b + n('adjust_points'), ...(ad === 'Elazığspor' ? { biz: true } : {}) };
  });
  // Modül team_order'a göre sıralar ama puan ayarları sonradan yapılmış olabilir: puana göre kararlı sırala.
  satirlar.sort((x, z) => z.p - x.p || z.av - x.av || z.a - x.a);
  satirlar.forEach((s, i) => { s.sira = i + 1; });
  const sec = deger('section') || '';
  return { puanDurumu: satirlar, guncel: deger('update') || null, grup: /white/i.test(sec) ? 'Beyaz' : /red/i.test(sec) ? 'Kırmızı' : null };
}

const sadelestir = (s = '') => s.toLocaleLowerCase('tr-TR')
  .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/i̇/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);

/** TFF oyuncusuna Vikipedi satırını eşler: ad parçaları alt kümesi ya da (aynı numara + aynı soyad). */
export function wikiEsle(oyuncu, wikiKadro) {
  const t = sadelestir(oyuncu.ad);
  return wikiKadro.find((w) => {
    const p = sadelestir(w.ad);
    if (p.length && p.every((x) => t.includes(x))) return true;
    return w.numara != null && w.numara === oyuncu.numara && p.at(-1) === t.at(-1);
  }) || null;
}

// ---------------------------------------------------------------- toplama

// Test: VERI_ATLA=A TFF'ye hiç istek atmadan başarısız sayar (B denenir); VERI_ATLA=A,B C'yi (önceki dosya) dener.
const ATLA = (process.env.VERI_ATLA || '').toUpperCase().split(',').map((x) => x.trim());

async function tffGetir(url, secenek = {}) {
  if (ATLA.includes('A')) throw new Error('VERI_ATLA ile atlandı (test)');
  return getir(url, { kodlama: 'oto', ...secenek });
}

async function wikiMetin(sayfa) {
  if (ATLA.includes('B')) throw new Error('VERI_ATLA ile atlandı (test)');
  const { text } = await getir(`${WIKI_API}?action=parse&format=json&formatversion=2&prop=wikitext&redirects=1&page=${encodeURIComponent(sayfa)}`);
  const j = JSON.parse(text);
  if (!j?.parse?.wikitext) throw new Error(`Vikipedi: ${sayfa} bulunamadı`);
  return j.parse.wikitext;
}

/** Sezon "2026-2027" -> Vikipedi madde adı "2026–27 TFF 2. Lig" */
const wikiLigSayfasi = (sezon) => {
  const [y1, y2] = (sezon || '').split('-');
  return y1 && y2 ? `${y1}–${y2.slice(2)} TFF 2. Lig` : null;
};

function varsayilanSezon() {
  const t = bugunTR();
  const y = Number(t.slice(0, 4));
  return Number(t.slice(5, 7)) >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

async function onbellekOku() {
  try { return JSON.parse(await readFile(path.join(PUBLIC, `${ONBELLEK}.json`), 'utf8')); } catch { return { oyuncular: {}, maclar: {} }; }
}

const gunFarki = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400e3 : Infinity);

/**
 * Maç sonu kontrolü (ELAZIGSPOR_KIP=macsonu): başlama saati 1,5–8 saat önce olan ve skoru bizde henüz
 * olmayan bir maç yoksa hiç istek atmadan çıkılır. Böylece maç günü skor akşamı beklemeden gelir.
 */
export function macSonuBekleniyor(onceki, simdi = Date.now()) {
  for (const m of onceki?.fikstur || []) {
    if (m.skor || !m.tarih) continue;
    const bas = Date.parse(`${m.tarih}T${m.saat || '12:00'}:00+03:00`);
    if (!Number.isFinite(bas)) continue;
    const fark = simdi - bas;
    if (fark >= 90 * 60_000 && fark <= 8 * 3600_000) return true;
  }
  return false;
}

export async function main() {
  const simdi = new Date().toISOString();
  const onceki = await oncekiniOku(AD);
  if (process.env.ELAZIGSPOR_KIP === 'macsonu' && !macSonuBekleniyor(onceki)) {
    console.log(`· ${AD}: bekleyen maç sonucu yok, atlandı`);
    return onceki;
  }
  const onbellek = await onbellekOku();
  onbellek.oyuncular ||= {};
  onbellek.maclar ||= {};
  const hatalar = [];
  const sonuc = {}; // bolum -> { veri, plan }
  let lig = { ad: '2. Lig', grup: null, sezon: null };
  let takim = { ad: 'Elazığspor', tamAd: null, stat: null };
  let ilkIstek = true;
  const sira = async () => { if (!ilkIstek) await bekle(ARA_MS); ilkIstek = false; };

  // --- A1: puan durumu (TFF lig sayfası)
  try {
    await sira();
    const { text } = await tffGetir(LIG_URL);
    const { sezon, puanDurumu, ceza } = puanCoz(text);
    if (sezon) lig.sezon = sezon;
    const gecerli = puanDurumu.filter(puanSatiriGecerli);
    if (gecerli.length < 10 || gecerli.length < puanDurumu.length * 0.8) throw new Error(`puan cetveli ${gecerli.length} satır`);
    if (!gecerli.some((s) => s.biz)) throw new Error('Elazığspor varsayılan grupta değil (grup değişmiş olabilir)');
    sonuc.puanDurumu = { veri: gecerli, plan: 'A', ek: ceza.length ? { ceza } : {} };
  } catch (e) { hatalar.push(`puan A: ${e.message}`); }

  // --- A2: fikstür + kadro (TFF kulüp sayfası, form gönderimi)
  let kulupForm = null, cerez = '';
  try {
    await sira();
    const { text, res } = await tffGetir(KULUP_URL);
    cerez = (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    kulupForm = formAlanlari(text);
    const duz = temizle(text.replace(/<script[\s\S]*?<\/script>/gi, ' '));
    const kod = duz.match(/([A-ZÇĞİÖŞÜ ]*ELAZIĞSPOR) Kulüp Kodu/);
    if (kod) takim.tamAd = baslikHarfi(kod[1].trim());
    const statM = duz.match(/([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ ]+STADYUMU)/);
    if (statM) takim.stat = baslikHarfi(statM[1].trim());
  } catch (e) { hatalar.push(`kulüp A: ${e.message}`); }

  const postla = async (alanlar, ek) => {
    await sira();
    const { text } = await tffGetir(KULUP_URL, {
      yontem: 'POST', govde: formGovdesi(alanlar, ek), deneme: 1,
      basliklar: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: KULUP_URL, ...(cerez ? { Cookie: cerez } : {}) },
    });
    return text;
  };

  if (kulupForm) {
    try {
      let html = await postla(kulupForm, { 'ctl00$MPane$m_28_398_ctnr$m_28_398$bntAra': 'Ara' });
      let { maclar, sonrakiHedef } = fiksturCoz(html);
      for (let s = 0; sonrakiHedef && s < 4; s++) {
        html = await postla(formAlanlari(html), { __EVENTTARGET: sonrakiHedef, __EVENTARGUMENT: '' });
        const r = fiksturCoz(html);
        maclar = maclar.concat(r.maclar);
        sonrakiHedef = r.sonrakiHedef;
      }
      const tekil = fiksturSirala([...new Map(maclar.map((m) => [m.macId || `${m.tarih}-${m.evSahibi}`, m])).values()]);
      if (tekil.length < 5) throw new Error(`fikstür ${tekil.length} maç`);
      const ligMac = tekil.find((m) => /2\. Lig/i.test(m.turnuva || ''));
      if (ligMac) {
        const g = ligMac.turnuva.match(/2\. Lig\s+(\S+)/)?.[1];
        if (g) lig.grup = baslikHarfi(g);
      }
      sonuc.fikstur = { veri: tekil, plan: 'A' };
    } catch (e) { hatalar.push(`fikstür A: ${e.message}`); }

    try {
      const html = await postla(kulupForm, { 'ctl00$MPane$m_28_196_ctnr$m_28_196$btnAra': 'Ara' });
      const kadro = kadroCoz(html);
      if (kadro.length < 15) throw new Error(`kadro ${kadro.length} oyuncu`);
      sonuc.kadro = { veri: kadro, plan: 'A' };
    } catch (e) { hatalar.push(`kadro A: ${e.message}`); }
  }

  // --- A3: maç ayrıntıları (oynanmış maçlar önbellekte kalır; sıradaki maç her gün yeniden okunur: saat/stat)
  const bugun = bugunTR();
  if (sonuc.fikstur) {
    const fikstur = sonuc.fikstur.veri;
    let yeni = 0;
    for (const m of fikstur) {
      // Olaysız (eski biçimli) kayıt bir kez yeniden okunur: geri doldurma.
      const kayit = m.macId && onbellek.maclar[m.macId];
      if (!m.macId || !m.skor || (kayit && kayit.olaylar) || yeni >= EN_FAZLA_MAC) continue;
      try {
        await sira();
        const { text } = await tffGetir(macUrl(m.macId));
        const d = macCoz(text);
        const olaylar = olaylarCoz(text);
        if (d.ev.ilk11.length + d.dep.ilk11.length >= 11) {
          onbellek.maclar[m.macId] = { ...d, ...(olaylarGecerli(olaylar) ? { olaylar } : {}), alindi: simdi };
          yeni++;
        }
      } catch (e) { hatalar.push(`maç ${m.macId}: ${e.message}`); }
    }
    const sonraki = fikstur.find((m) => !m.skor && m.macId && (!m.tarih || m.tarih >= bugun));
    if (sonraki) {
      try {
        await sira();
        const { text } = await tffGetir(macUrl(sonraki.macId));
        const d = macCoz(text);
        if (d.saat) sonraki.saat = d.saat;
        if (d.tarih) sonraki.tarih = d.tarih;
        if (d.stat) sonraki.stat = d.stat;
      } catch (e) { hatalar.push(`sıradaki maç: ${e.message}`); }
    }
    for (const m of fikstur) {
      const d = m.macId && onbellek.maclar[m.macId];
      if (d) { if (d.saat) m.saat = d.saat; if (d.stat) m.stat = d.stat; }
      if (d?.olaylar && m.skor) m.olaylar = d.olaylar;
    }

    // --- Yayın kanalı (oynanmamış maçlar). Tablo okunamazsa önbellekteki kanal kalır.
    onbellek.yayin ||= {};
    try {
      await sira();
      const { text } = await getir(YAYIN_URL);
      const satirlar = yayinCoz(text);
      if (!satirlar.length) throw new Error('yayın tablosu boş/biçim değişmiş');
      for (const m of fikstur) {
        if (m.skor || !m.macId) continue;
        const kanal = yayinBul(m, satirlar);
        if (kanal) onbellek.yayin[m.macId] = { kanal, tarih: m.tarih };
        // Tabloda maçın günü varsa ama maç yoksa (yayın programına alınmamış ya da tarih değişmiş) eski kanal silinir.
        else if (satirlar.some((s) => s.tarih === m.tarih)) delete onbellek.yayin[m.macId];
      }
    } catch (e) { hatalar.push(`yayın: ${e.message}`); }
    const oynanmamis = new Set(fikstur.filter((m) => !m.skor && m.macId).map((m) => m.macId));
    for (const id of Object.keys(onbellek.yayin)) if (!oynanmamis.has(id)) delete onbellek.yayin[id];
    for (const m of fikstur) {
      const y = !m.skor && m.macId && onbellek.yayin[m.macId];
      // Tarih değiştiyse (erteleme) eski kanal gösterilmez.
      if (y && y.tarih === m.tarih) m.yayin = y.kanal;
    }
    const atilan = kadroBoyutla(fikstur, bugun);
    if (atilan) console.warn(`  ~ boyut sınırı: ${atilan} eski maçın adlı kadrosu atıldı`);
  }

  // --- B / mevki: Vikipedi kadrosu (A'da da mevki için okunur)
  let wikiKadro = null;
  try {
    await sira();
    wikiKadro = wikiKadroCoz(await wikiMetin(WIKI_KULUP));
  } catch (e) { hatalar.push(`Vikipedi kadro: ${e.message}`); }

  // --- A4: oyuncu ayrıntıları + istatistik
  if (sonuc.kadro) {
    const ist = istatistikTopla(Object.values(onbellek.maclar));
    let okunan = 0;
    for (const o of sonuc.kadro.veri) {
      const kayit = onbellek.oyuncular[o.id];
      if ((!kayit || gunFarki(kayit.alindi) > OYUNCU_YENILE_GUN) && okunan < EN_FAZLA_OYUNCU) {
        try {
          await sira();
          const { text } = await tffGetir(oyuncuUrl(o.id));
          const d = oyuncuCoz(text);
          if (d.dogum || d.uyruk) onbellek.oyuncular[o.id] = { ...d, alindi: simdi };
          okunan++;
        } catch (e) { hatalar.push(`oyuncu ${o.id}: ${e.message}`); }
      }
      const d = onbellek.oyuncular[o.id] || {};
      const s = ist[o.id];
      o.numara = s?.numara ?? null;
      o.dogum = d.dogum ?? null;
      o.dogumYeri = d.dogumYeri ?? null;
      o.uyruk = d.uyruk ?? null;
      o.mac = s?.mac ?? 0;
      o.ilk11 = s?.ilk11 ?? 0;
      o.gol = s?.gol ?? 0;
      o.sari = s?.sari ?? 0;
      o.kirmizi = s?.kirmizi ?? 0;
      const w = wikiKadro ? wikiEsle(o, wikiKadro.kadro) : null;
      o.mevki = w?.mevki ?? null;
      if (o.numara == null && w?.numara != null) o.numara = w.numara;
    }
    // Kadrodan çıkan oyuncuların önbellek kaydını at (KVKK: gereksiz kişisel veri tutma).
    const ids = new Set(sonuc.kadro.veri.map((o) => o.id));
    for (const id of Object.keys(onbellek.oyuncular)) if (!ids.has(id)) delete onbellek.oyuncular[id];
  }

  // --- B: Vikipedi (yalnız A'nın okuyamadığı bölümler). Önceki A verisi yeterince tazeyse (puan 3 gün, kadro 14 gün)
  // yedek yerine o tutulur (C): gönüllü sayfası genelde TFF'nin dünkü verisinden daha eskidir.
  const oncekiTaze = (ad, gun) => onceki?.bolumler?.[ad]?.plan === 'A' && Array.isArray(onceki?.[ad]) && onceki[ad].length &&
    gunFarki(onceki.bolumler[ad].sonBasari) <= gun;
  if (!sonuc.kadro && !oncekiTaze('kadro', 14) && wikiKadro?.kadro.length >= 15) {
    sonuc.kadro = {
      plan: 'B',
      ek: { not: `Yedek kaynak${wikiKadro.guncel ? ` (${wikiKadro.guncel} itibarıyla)` : ''}; doğum tarihi ve maç istatistiği yok` },
      veri: wikiKadro.kadro.map((w) => ({
        id: `w-${sadelestir(w.ad).join('-')}`, ad: w.ad, numara: w.numara, mevki: w.mevki, uyruk: w.uyruk,
        dogum: null, dogumYeri: null, mac: null, ilk11: null, gol: null, sari: null, kirmizi: null,
      })),
    };
  }
  if (!sonuc.puanDurumu && !oncekiTaze('puanDurumu', 3)) {
    try {
      const sayfa = wikiLigSayfasi(lig.sezon || varsayilanSezon());
      await sira();
      const w = wikiPuanCoz(await wikiMetin(sayfa));
      if (w.puanDurumu.length >= 10 && w.puanDurumu.some((s) => s.biz)) {
        sonuc.puanDurumu = { veri: w.puanDurumu, plan: 'B', ek: { not: `Yedek kaynak${w.guncel ? ` (${w.guncel} itibarıyla)` : ''}` } };
        if (!lig.grup && w.grup) lig.grup = w.grup;
      } else hatalar.push('puan B: Elazığspor tablosu bulunamadı');
    } catch (e) { hatalar.push(`puan B: ${e.message}`); }
  }

  // --- birleştir (C: okunamayan bölüm önceki dosyadan)
  lig.sezon ||= onceki?.lig?.sezon || varsayilanSezon();
  lig.grup ||= onceki?.lig?.grup || null;
  takim.tamAd ||= onceki?.takim?.tamAd || null;
  if (!takim.stat && sonuc.fikstur) {
    // Yedek: iç saha maçlarında en sık geçen stat
    const say = {};
    for (const m of sonuc.fikstur.veri) if (m.ev && m.stat) say[m.stat] = (say[m.stat] || 0) + 1;
    takim.stat = Object.entries(say).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  takim.stat ||= onceki?.takim?.stat || null;
  const bolumler = {};
  const veri = {};
  let tazeSayisi = 0;
  for (const ad of ['puanDurumu', 'fikstur', 'kadro']) {
    const s = sonuc[ad];
    if (s) {
      veri[ad] = s.veri;
      bolumler[ad] = { durum: 'guncel', plan: s.plan, sonBasari: simdi, ...(s.ek || {}) };
      tazeSayisi++;
    } else if (Array.isArray(onceki?.[ad])) {
      veri[ad] = onceki[ad];
      bolumler[ad] = { ...(onceki.bolumler?.[ad] || {}), durum: 'eski', sonDeneme: simdi };
    } else {
      veri[ad] = [];
      bolumler[ad] = { durum: 'yok', sonDeneme: simdi };
    }
  }
  const planlar = Object.values(sonuc).map((s) => s.plan);

  if (hatalar.length) for (const h of hatalar) console.warn(`  ! ${h}`);

  if (!tazeSayisi) {
    if (onceki && !KURU) {
      await dosyaYaz(AD, { ...onceki, durum: 'eski', sonDeneme: simdi, bolumler });
      console.warn(`  ~ ${AD}.json: önceki dosya korundu, durum=eski`);
    }
    throw new Error(`${AD}: tüm kaynaklar başarısız -> ${hatalar.slice(0, 6).join(' | ')}`);
  }

  const cikti = {
    guncelleme: simdi,
    durum: 'guncel',
    plan: planlar.every((p) => p === 'A') ? 'A' : 'B',
    kaynak: planlar.includes('A') ? 'TFF' : 'Vikipedi',
    kaynakUrl: KULUP_URL,
    sonBasari: simdi,
    lig: { ...lig, ad: bahissiz(lig.ad) },
    takim,
    bolumler,
    puanDurumu: veri.puanDurumu,
    fikstur: veri.fikstur,
    kadro: veri.kadro,
  };

  if (KURU) {
    const biz = cikti.puanDurumu.find((s) => s.biz);
    console.log(JSON.stringify({ lig: cikti.lig, takim, bolumler, sira: biz?.sira, puan: biz?.p, fikstur: cikti.fikstur.length, kadro: cikti.kadro.length, ornekOyuncu: cikti.kadro[0] }, null, 1));
    return { ...cikti, ogeler: cikti.kadro };
  }
  // Önbellek ayrı dosyada (gh-pages'te kalır, iş akışı geri çeker); uygulama okumaz.
  await dosyaYaz(ONBELLEK, { guncelleme: simdi, ...onbellek });
  await dosyaYaz(AD, cikti);
  console.log(`✔ ${AD}.json: puan ${cikti.puanDurumu.length} (${bolumler.puanDurumu.durum}/${bolumler.puanDurumu.plan || '-'}), ` +
    `fikstür ${cikti.fikstur.length} (${bolumler.fikstur.durum}), kadro ${cikti.kadro.length} (${bolumler.kadro.durum}/${bolumler.kadro.plan || '-'})`);
  // run-all durum.json için: öğe sayısı = kadro
  return { ...cikti, ogeler: cikti.kadro };
}

calistir(import.meta, main);
