// Ortak yardımcılar: indirme (zaman aşımı + sınırlı yeniden deneme), HTML temizleme,
// Türkçe tarih ayrıştırma, "bozmadan yaz" (doğrula -> geçici dosya -> yeniden adlandır)
// ve A/B/C kaynak planı (planlarlaYaz).
// Bağımlılık yok; Node 22 yerleşik fetch kullanılır.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC = path.join(KOK, 'public');

// Nötr UA: uygulama ya da kişi adı içermez. Tarayıcı taklidi DEĞİLDİR (gerçek bir tarayıcı dizisi kopyalanmaz).
export const UA = process.env.VERI_UA || 'Mozilla/5.0 (compatible; veri-okuyucu/1.0)';

export const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// Bu çalıştırmada 403/429 veren sunucular: aynı çalıştırmada onlara bir daha istek atılmaz.
const ENGELLI = new Set();

/**
 * Metin indirir, 25 sn zaman aşımı. kodlama: 'oto' ise yanıt Content-Type charset'iyle çözülür (varsayılan UTF-8).
 * Yeniden deneme: yalnız ağ hatası / zaman aşımı / 5xx'te, en fazla 1 kez (deneme=2).
 * 4xx'te (403/404/429 dahil) yeniden deneme YOK; 403/429 veren sunucu bu çalıştırma boyunca bir daha denenmez.
 * @returns {Promise<{text: string, res: Response}>}
 */
export async function getir(url, { yontem = 'GET', govde, basliklar = {}, deneme = 2, zamanAsimi = 25000, kodlama } = {}) {
  const host = new URL(url).host;
  if (ENGELLI.has(host)) throw new Error(`${host} bu çalıştırmada 403/429 verdi, tekrar istek atılmıyor`);
  let sonHata;
  for (let i = 0; i < deneme; i++) {
    let res;
    try {
      res = await fetch(url, {
        method: yontem,
        body: govde,
        headers: { 'User-Agent': UA, 'Accept-Language': 'tr-TR,tr;q=0.9', ...basliklar },
        redirect: 'follow',
        signal: AbortSignal.timeout(zamanAsimi),
      });
    } catch (e) {
      sonHata = e; // ağ hatası / zaman aşımı -> yeniden denenebilir
      if (i < deneme - 1) await bekle(2000);
      continue;
    }
    if (res.status === 403 || res.status === 429) ENGELLI.add(host);
    if (res.status >= 400 && res.status < 500) throw new Error(`HTTP ${res.status} ${url}`);
    if (!res.ok) {
      sonHata = new Error(`HTTP ${res.status} ${url}`); // 5xx -> yeniden denenebilir
      if (i < deneme - 1) await bekle(2000);
      continue;
    }
    // kodlama: verilmezse UTF-8 (res.text() ile aynı). 'oto' = Content-Type charset'i (ör. windows-1254 kullanan siteler).
    const cs = kodlama === 'oto' ? (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1] : kodlama;
    const ham = await res.arrayBuffer();
    let text;
    try { text = new TextDecoder(cs || 'utf-8').decode(ham); } catch { text = new TextDecoder('utf-8').decode(ham); }
    return { text, res };
  }
  throw sonHata;
}

export async function getirJson(url, secenek) {
  const { text } = await getir(url, secenek);
  return JSON.parse(text);
}

const VARLIKLAR = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', ndash: '–', mdash: '—',
};

/** HTML varlıklarını çözer (&amp; &#039; &#x27; vb.). Metni başka şekilde değiştirmez. */
export function varlikCoz(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, k) => {
    if (k[0] === '#') {
      const n = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return VARLIKLAR[k.toLowerCase()] ?? m;
  });
}

/** Etiketleri atar, varlıkları çözer, boşlukları tekler. */
export function temizle(html = '') {
  return varlikCoz(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export const AYLAR = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];

const kucuk = (s) => s.toLocaleLowerCase('tr-TR').trim();

/** "21 Kasım 2026" -> "2026-11-21" */
export function trTarih(gun, ay, yil) {
  const a = AYLAR.indexOf(kucuk(ay));
  if (a < 0) return null;
  return `${yil}-${String(a + 1).padStart(2, '0')}-${String(gun).padStart(2, '0')}`;
}

/** "21 Kasım 2026" metninden ISO tarih */
export function trTarihMetin(s = '') {
  const m = s.match(/(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})/);
  return m ? trTarih(m[1], m[2], m[3]) : null;
}

/** "29.11.2026" -> "2026-11-29" */
export function noktaliTarih(s = '') {
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/** Şu anki Türkiye tarihi "YYYY-MM-DD" (Türkiye UTC+3, yaz saati yok). */
export function bugunTR(gunEkle = 0) {
  const d = new Date(Date.now() + 3 * 3600e3 + gunEkle * 86400e3);
  return d.toISOString().slice(0, 10);
}

/** Haversine, km */
export function uzaklikKm(lat1, lon1, lat2, lon2) {
  const R = 6371, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const ELAZIG = { lat: 38.67, lon: 39.22 };

/** "TIR-ÇEKİCİ ŞOFÖRÜ" -> "Tır-Çekici Şoförü" (Türkçe büyük/küçük harf kurallarıyla) */
export function baslikHarfi(s = '') {
  return s.toLocaleLowerCase('tr-TR').replace(/(^|[\s\-/(])(\p{L})/gu, (m, a, h) => a + h.toLocaleUpperCase('tr-TR'));
}

export async function dosyaYaz(ad, veri) {
  await mkdir(PUBLIC, { recursive: true });
  const hedef = path.join(PUBLIC, `${ad}.json`);
  const gecici = `${hedef}.tmp`;
  const metin = JSON.stringify(veri, null, 1);
  JSON.parse(metin); // kendini doğrula
  await writeFile(gecici, metin, 'utf8');
  await rename(gecici, hedef);
}

/**
 * Ortak şekilde JSON yazar:
 *   { guncelleme, durum: 'guncel', plan, kaynak, kaynakUrl, sonBasari, ...ek, ogeler }
 * - ogeler dizi değilse veya (bosOlabilir=false iken) boşsa YAZMAZ, hata fırlatır -> önceki dosya korunur.
 * - dogrula(oge) verilirse her öğe kontrol edilir; geçersiz öğe oranı %20'yi aşarsa yazmaz.
 * - Önce .tmp dosyasına yazar, sonra rename (yarım dosya kalmaz).
 */
export async function yaz(ad, { kaynak, kaynakUrl, ogeler, ek = {}, bosOlabilir = false, dogrula, enAz = 1, plan = 'A' }) {
  if (!Array.isArray(ogeler)) throw new Error(`${ad}: ogeler dizi değil`);
  if (dogrula) {
    const gecerli = ogeler.filter((o) => { try { return dogrula(o); } catch { return false; } });
    if (ogeler.length && gecerli.length / ogeler.length < 0.8) {
      throw new Error(`${ad}: öğelerin %${Math.round((1 - gecerli.length / ogeler.length) * 100)}'i geçersiz, yazılmadı (site yapısı değişmiş olabilir)`);
    }
    ogeler = gecerli;
  }
  if (!bosOlabilir && ogeler.length < enAz) {
    throw new Error(`${ad}: ${ogeler.length} öğe (en az ${enAz} bekleniyordu)`);
  }
  const simdi = new Date().toISOString();
  const veri = { guncelleme: simdi, durum: 'guncel', plan, kaynak, kaynakUrl, sonBasari: simdi, ...ek, ogeler };
  await dosyaYaz(ad, veri);
  console.log(`✔ ${ad}.json: ${ogeler.length} öğe (plan ${plan}: ${kaynak})`);
  return veri;
}

export async function oncekiniOku(ad) {
  try { return JSON.parse(await readFile(path.join(PUBLIC, `${ad}.json`), 'utf8')); } catch { return null; }
}

/**
 * C planı: hiçbir kaynak çalışmadıysa önceki geçerli dosya OLDUĞU GİBİ kalır (ogeler, kaynak, plan değişmez),
 * yalnız üst alanlara durum:'eski', sonBasari (son başarılı yazım) ve sonDeneme eklenir.
 * Uygulama bunu görünce "güncellenemedi, kaynağı aç" diyebilir. Önceki dosya yoksa hiçbir şey yazılmaz.
 */
export async function eskiOlarakIsaretle(ad) {
  const onceki = await oncekiniOku(ad);
  if (!onceki || !Array.isArray(onceki.ogeler)) return false;
  const { ogeler, ...ust } = onceki;
  const veri = { ...ust, durum: 'eski', sonBasari: onceki.sonBasari || onceki.guncelleme || null, sonDeneme: new Date().toISOString(), ogeler };
  await dosyaYaz(ad, veri);
  console.warn(`  ~ ${ad}.json: önceki dosya korundu, durum=eski (son başarı ${veri.sonBasari})`);
  return true;
}

/**
 * A/B/C kaynak planı. planlar sırayla denenir; ilk başarılı (indirme + ayrıştırma + doğrulama) olan yazılır.
 *   planlar: [{ kod: 'A' | 'B' | 'B2', kaynak, kaynakUrl, calis: async () => ({ ogeler, ek?, kaynak?, kaynakUrl? }),
 *              dogrula?, enAz?, bosOlabilir?, ek? }]
 *   ortak:   tüm planlar için varsayılan yaz() seçenekleri (dogrula, enAz, bosOlabilir, ek); plan kendi değerleriyle ezer.
 * JSON'daki "plan" alanı kodun ilk harfidir ("B2" -> "B"); hangi yedeğin kullanıldığı "kaynak"/"kaynakUrl"'den görünür.
 * Hepsi başarısızsa C: önceki dosya korunur ve durum:'eski' işaretlenir, sonra hata fırlatılır (run-all durum.json'a yazar).
 *
 * Test için: VERI_ATLA=A (veya A,B) ortam değişkeni verilen planları HİÇ İSTEK ATMADAN başarısız sayar.
 */
export async function planlarlaYaz(ad, planlar, ortak = {}) {
  const atla = (process.env.VERI_ATLA || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  const hatalar = [];
  for (const p of planlar) {
    const etiket = `${p.kod} (${p.kaynak})`;
    try {
      if (atla.includes(p.kod)) throw new Error('VERI_ATLA ile atlandı (test)');
      const sonuc = await p.calis();
      const sec = (k) => (p[k] !== undefined ? p[k] : ortak[k]);
      return await yaz(ad, {
        plan: p.kod.charAt(0),
        kaynak: sonuc.kaynak || p.kaynak,
        kaynakUrl: sonuc.kaynakUrl || p.kaynakUrl,
        ogeler: sonuc.ogeler,
        ek: { ...(ortak.ek || {}), ...(p.ek || {}), ...(sonuc.ek || {}) },
        bosOlabilir: sec('bosOlabilir'),
        dogrula: sec('dogrula'),
        enAz: sec('enAz'),
      });
    } catch (e) {
      hatalar.push(`${etiket}: ${e.message}`);
      console.warn(`  ! plan ${etiket}: ${e.message}`);
    }
  }
  await eskiOlarakIsaretle(ad);
  throw new Error(`${ad}: tüm kaynaklar başarısız -> ${hatalar.join(' | ')}`);
}

/** Betik doğrudan çalıştırıldıysa main()'i çalıştırır ve hata kodunu ayarlar. */
export function calistir(meta, main) {
  if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(meta.url)) {
    main().catch((e) => { console.error(`✖ ${e.message}`); process.exitCode = 1; });
  }
}
