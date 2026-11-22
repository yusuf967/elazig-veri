// Altın/döviz fiyat geçmişi (uygulamadaki ayrıntı grafiği ve aralık sekmeleri için).
// Truncgil yalnız anlık fiyat verir; geçmişi biz biriktiririz:
//  - Her 'sik' çalıştırmada (30 dk) aynı çalıştırmada yazılmış public/piyasa.json'dan seçili kalemlerin SATIŞ fiyatı eklenir.
//    Uygulamanın ayarlarında ek fiyat verisi varsa o kalemlerde aynı kuralla o yazılır (grafik, uygulamada görülen fiyatla aynı olsun).
//  - Seyreltme: son 2 gün 30 dakikalık, son 30 gün saatlik, son 2 yıl günlük nokta; daha eskisi atılır. Her dilimde dilimin SON
//    değeri (kapanış) kalır. Dilimler Türkiye saatine göre (UTC+3) hesaplanır.
//  - Geri doldurma (bir kez): USD/EUR/GBP için Frankfurter (ECB günlük referans kuru, anahtarsız) ile son 2 yılın günlük kuru.
//    Yalnız ilk gerçek ölçümden ÖNCEKİ günlere yazılır. Altın geri doldurulmaz;
//    türetilmiş seri uygulamadaki fiyatla örtüşmüyor, grafikte yapay basamak oluşurdu. Altın geçmişi zamanla birikir.
//  - Taze piyasa verisi yoksa (piyasa betiği bu çalıştırmada başarısızsa) nokta eklenmez, önceki dosya korunur.
// Çıktı: { guncelleme, durum, kaynak, not, geriDoldurma, kalemler: { "<kod>": [[unixSaniye, satis], ...] } } (eskiden yeniye)
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PUBLIC, getirJson, oncekiniOku, calistir } from '../lib/ortak.mjs';

export const AD = 'piyasa-gecmis';
const FR = 'https://api.frankfurter.dev/v1';

// Uygulamadaki kalem kimlikleri. piyasa.json'daki "kod" bazı kalemlerde farklı (GRAM, CEYREK ...).
export const KALEMLER = [
  'gram-altin', 'ceyrek-altin', 'yarim-altin', 'tam-altin', 'cumhuriyet-altini', '22-ayar-bilezik',
  'gram-has-altin', 'ata-altin', 'gumus', 'USD', 'EUR', 'GBP',
];
const PIYASA_KODU = {
  'gram-altin': 'GRAM', 'ceyrek-altin': 'CEYREK', 'yarim-altin': 'YARIM', 'tam-altin': 'TAM',
  'cumhuriyet-altini': 'CUMHURIYET', '22-ayar-bilezik': 'YIA', 'gram-has-altin': 'HAS', 'ata-altin': 'ATA',
  gumus: 'GUMUS', USD: 'USD', EUR: 'EUR', GBP: 'GBP',
};
const DOVIZ = ['USD', 'EUR', 'GBP'];

const DK = 60, SAAT = 3600, GUN = 86400;
const TR = 3 * SAAT; // Türkiye UTC+3 (yaz saati yok)
// [yaş sınırı (sn), dilim (sn)] — yaşa göre ilk uyan katman.
export const KATMANLAR = [
  [2 * GUN, 30 * DK],
  [30 * GUN, SAAT],
  [730 * GUN, GUN],
];
/** piyasa.json bundan eskiyse bu çalıştırmada yazılmamış sayılır (başarısız betik önceki dosyayı bırakır). */
const TAZELIK_SN = 45 * DK;

const yuvarla = (kod, v) => {
  const k = DOVIZ.includes(kod) ? 1e4 : 1e2;
  return Math.round(v * k) / k;
};

/**
 * Noktaları yaşa göre seyreltir: her dilimde son nokta kalır, 2 yıldan eski ve gelecekteki (saat kayması payı 1 sa) atılır.
 * Saf fonksiyon; aynı girdiye aynı çıktı (her çalıştırmada yeniden uygulanabilir).
 */
export function seyrelt(noktalar, simdi) {
  const kovalar = new Map();
  for (const n of noktalar) {
    if (!Array.isArray(n) || !Number.isFinite(n[0]) || !Number.isFinite(n[1]) || n[1] <= 0) continue;
    const yas = simdi - n[0];
    if (yas < -SAAT) continue;
    const katman = KATMANLAR.find(([sinir]) => yas <= sinir);
    if (!katman) continue;
    const anahtar = `${katman[1]}:${Math.floor((n[0] + TR) / katman[1])}`;
    const var_ = kovalar.get(anahtar);
    if (!var_ || n[0] >= var_[0]) kovalar.set(anahtar, n);
  }
  return [...kovalar.values()].sort((a, b) => a[0] - b[0]);
}

/** Uygulamadaki yerelHarita ile aynı: en az 4 geçerli kalem yoksa yerel fiyat kullanılmaz. */
export function yerelSatislar(yerel) {
  if (!Array.isArray(yerel?.ogeler)) return null;
  const m = {};
  for (const o of yerel.ogeler) {
    if (typeof o?.kod === 'string' && typeof o.satis === 'number' && o.satis > 0) m[o.kod] = o.satis;
  }
  return Object.keys(m).length >= 4 ? m : null;
}

/** Bu çalıştırmanın anlık görüntüsü: { kod: satis }. piyasa.json taze değilse null. */
export function anlikGoruntu(piyasa, yerel, simdiSn) {
  if (!piyasa || piyasa.durum !== 'guncel' || !Array.isArray(piyasa.ogeler)) return null;
  const t = Date.parse(piyasa.guncelleme) / 1000;
  if (!Number.isFinite(t) || simdiSn - t > TAZELIK_SN) return null;
  const genel = new Map(piyasa.ogeler.map((o) => [o.kod, o.satis]));
  const ys = yerelSatislar(yerel);
  const sonuc = {};
  for (const kod of KALEMLER) {
    const v = ys?.[kod] ?? genel.get(PIYASA_KODU[kod]);
    if (typeof v === 'number' && v > 0) sonuc[kod] = yuvarla(kod, v);
  }
  return Object.keys(sonuc).length ? sonuc : null;
}

/** Frankfurter (base=EUR, symbols=TRY,USD,GBP) zaman serisi -> { USD: [[t, tl]], EUR: [...], GBP: [...] }. */
export function frankfurterCevir(j) {
  const sonuc = { USD: [], EUR: [], GBP: [] };
  for (const [gun, r] of Object.entries(j?.rates || {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gun) || !(r?.TRY > 0)) continue;
    // ECB referans kuru 16:00 CET'te açıklanır (15:00 UTC).
    const t = Date.parse(`${gun}T15:00:00Z`) / 1000;
    sonuc.EUR.push([t, yuvarla('EUR', r.TRY)]);
    if (r.USD > 0) sonuc.USD.push([t, yuvarla('USD', r.TRY / r.USD)]);
    if (r.GBP > 0) sonuc.GBP.push([t, yuvarla('GBP', r.TRY / r.GBP)]);
  }
  return sonuc;
}

/** Geri doldurma noktalarını yalnız ilk gerçek ölçümden önceki zamana ekler. */
export function oneEkle(gercek = [], geri = []) {
  const ilk = gercek.length ? gercek[0][0] : Infinity;
  return [...geri.filter((n) => n[0] < ilk), ...gercek];
}

/**
 * Önceki dosya + anlık görüntü + (varsa) geri doldurma -> yeni kalemler. Saf fonksiyon.
 * geri: { kod: [[t, v]] } | null
 */
export function birlestir(oncekiKalemler, goruntu, simdiSn, geri = null) {
  const kalemler = {};
  for (const kod of KALEMLER) {
    let liste = Array.isArray(oncekiKalemler?.[kod]) ? [...oncekiKalemler[kod]] : [];
    if (geri?.[kod]?.length) liste = oneEkle(liste, geri[kod]);
    if (goruntu?.[kod] != null) liste.push([simdiSn, goruntu[kod]]);
    liste = seyrelt(liste, simdiSn);
    if (liste.length) kalemler[kod] = liste;
  }
  return kalemler;
}

/** Uygulama ayarlarındaki ek fiyat verisi (herkese açık okuma); yoksa null. */
async function ekVeriOku() {
  const sb = process.env.SUPABASE_URL;
  const anahtar = process.env.SUPABASE_KEY;
  if (!sb || !anahtar) return null;
  try {
    const j = await getirJson(`${sb.replace(/\/$/, '')}/rest/v1/flags?key=eq.ek_fiyat&select=value`, { basliklar: { apikey: anahtar, Authorization: `Bearer ${anahtar}` }, deneme: 1, zamanAsimi: 10000 });
    return j?.[0]?.value ?? null;
  } catch {
    return null;
  }
}

async function jsonOku(ad) {
  try { return JSON.parse(await readFile(path.join(PUBLIC, `${ad}.json`), 'utf8')); } catch { return null; }
}

/** dosyaYaz gibi (geçici dosya + yeniden adlandırma) ama girintisiz: binlerce nokta girintiyle ~3 kat büyürdü. */
async function kompaktYaz(veri) {
  await mkdir(PUBLIC, { recursive: true });
  const hedef = path.join(PUBLIC, `${AD}.json`);
  const metin = JSON.stringify(veri);
  JSON.parse(metin); // kendini doğrula
  await writeFile(`${hedef}.tmp`, metin, 'utf8');
  await rename(`${hedef}.tmp`, hedef);
}

async function dovizGeriDoldur(simdiSn) {
  const bas = new Date((simdiSn - 730 * GUN) * 1000).toISOString().slice(0, 10);
  return frankfurterCevir(await getirJson(`${FR}/${bas}..?base=EUR&symbols=TRY,USD,GBP`));
}

export async function main() {
  const simdiSn = Math.floor(Date.now() / 1000);
  const onceki = await oncekiniOku(AD);
  const goruntu = anlikGoruntu(await jsonOku('piyasa'), await ekVeriOku(), simdiSn);

  const geriDoldurma = { doviz: null, ...(onceki?.geriDoldurma || {}) };
  let geri = null;
  if (!geriDoldurma.doviz) {
    try {
      geri = await dovizGeriDoldur(simdiSn);
      if (geri.USD.length > 100) geriDoldurma.doviz = new Date(simdiSn * 1000).toISOString();
      else geri = null;
    } catch (e) {
      console.warn(`  ! ${AD}: döviz geri doldurma olmadı (${e.message}), sonraki çalıştırmada yeniden denenecek`);
    }
  }

  if (!goruntu && !geri) {
    throw new Error(`${AD}: taze piyasa verisi yok (piyasa.json bu çalıştırmada yazılmamış), önceki dosya korundu`);
  }

  // Tek seferlik: ilk gün gram altın yanlış kalemden (işçilikli 1 gr) kaydedildi; o noktaları at.
  let oncekiKalemler = onceki?.kalemler;
  if (!geriDoldurma.gramDuzeltme && oncekiKalemler?.['gram-altin']) {
    oncekiKalemler = { ...oncekiKalemler };
    delete oncekiKalemler['gram-altin'];
    geriDoldurma.gramDuzeltme = new Date(simdiSn * 1000).toISOString();
  }

  const kalemler = birlestir(oncekiKalemler, goruntu, simdiSn, geri);
  const simdi = new Date(simdiSn * 1000).toISOString();
  const veri = {
    guncelleme: simdi,
    durum: goruntu ? 'guncel' : 'eski',
    kaynak: 'Piyasa ölçümü (30 dk); döviz geçmişi ECB referans kuru',
    not: 'Satış fiyatı. Son 2 gün 30 dk, son 30 gün saatlik, son 2 yıl günlük. Zaman: unix saniye.',
    geriDoldurma,
    kalemler,
  };
  await kompaktYaz(veri);
  const toplam = Object.values(kalemler).reduce((s, l) => s + l.length, 0);
  console.log(`✔ ${AD}.json: ${Object.keys(kalemler).length} kalem, ${toplam} nokta${geri ? ' (döviz geri dolduruldu)' : ''}`);
  // run-all durum.json için: ogeler sayısı yerine kalem sayısı
  return { ogeler: Object.keys(kalemler), plan: 'A', kaynak: veri.kaynak };
}

calistir(import.meta, main);
