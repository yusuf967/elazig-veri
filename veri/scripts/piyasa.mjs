// Altın ve döviz.
//  A: Truncgil Finans (finans.truncgil.com) ücretsiz/anahtarsız JSON, v4 + v1 (ikisinden biri yeterli).
//  B: Frankfurter (api.frankfurter.dev, ECB referans kurları) — YALNIZ USD/EUR/GBP; altın bu kaynakta yok.
//     Günlük referans kurudur: alis=null, satis=kur, degisimYuzde=önceki iş gününe göre.
//  C: önceki dosya korunur, durum:'eski'.
// Uygulama Truncgil'i DOĞRUDAN çağırabilir (CORS: *). Bu ayna:
//  - sayıları normalleştirir (v1 Türkçe metin "5.730,97" -> 5730.97),
//  - v4'te ONS 0 geldiği için onsu v1'den alır,
//  - Truncgil düşerse uygulamaya son bilinen değeri verir.
// DİKKAT: Truncgil yanıtları "Cache-Control: max-age=315360000" ile geliyor; doğrudan çağrıda ?t=<zaman> ekleyin.
import { getirJson, planlarlaYaz, calistir } from '../lib/ortak.mjs';

export const AD = 'piyasa';
const V1 = 'https://finans.truncgil.com/today.json';
const V4 = 'https://finans.truncgil.com/v4/today.json';
const FR = 'https://api.frankfurter.dev/v1';

const trSayi = (s) => {
  if (typeof s === 'number') return s;
  if (!s) return null;
  const n = Number(String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const yuzde = (s) => trSayi(String(s ?? '').replace('%', ''));

// kod -> [v4 anahtarı, v1 anahtarı, görünen ad, tür, birim]
const KALEMLER = [
  ['USD', 'USD', 'USD', 'Amerikan Doları', 'doviz', 'TRY'],
  ['EUR', 'EUR', 'EUR', 'Euro', 'doviz', 'TRY'],
  ['GBP', 'GBP', 'GBP', 'İngiliz Sterlini', 'doviz', 'TRY'],
  ['GRAM', 'GRA', 'gram-altin', 'Gram Altın', 'altin', 'TRY'],
  ['CEYREK', 'CEYREKALTIN', 'ceyrek-altin', 'Çeyrek Altın', 'altin', 'TRY'],
  ['YARIM', 'YARIMALTIN', 'yarim-altin', 'Yarım Altın', 'altin', 'TRY'],
  ['TAM', 'TAMALTIN', 'tam-altin', 'Tam Altın', 'altin', 'TRY'],
  ['CUMHURIYET', 'CUMHURIYETALTINI', 'cumhuriyet-altini', 'Cumhuriyet Altını', 'altin', 'TRY'],
  ['ONS', 'ONS', 'ons', 'Ons Altın', 'altin', 'USD'],
  ['GUMUS', 'GUMUS', 'gumus', 'Gram Gümüş', 'gumus', 'TRY'],
  ['ATA', 'ATAALTIN', 'ata-altin', 'Ata Altın', 'altin', 'TRY'],
  ['YIA', 'YIA', '22-ayar-bilezik', '22 Ayar Bilezik', 'altin', 'TRY'],
  ['HAS', 'HAS', 'gram-has-altin', 'Has Altın', 'altin', 'TRY'],
  ['RESAT', 'RESATALTIN', 'resat-altin', 'Reşat Altın', 'altin', 'TRY'],
  ['BESLI', 'BESLIALTIN', 'besli-altin', 'Beşli Altın', 'altin', 'TRY'],
  ['GREMSE', 'GREMSEALTIN', 'gremse-altin', 'Gremse Altın', 'altin', 'TRY'],
  ['AYAR18', '18AYARALTIN', '18-ayar-altin', '18 Ayar Altın', 'altin', 'TRY'],
  ['AYAR14', '14AYARALTIN', '14-ayar-altin', '14 Ayar Altın', 'altin', 'TRY'],
];

async function truncgil() {
  const t = Date.now();
  const [v1, v4] = await Promise.allSettled([getirJson(`${V1}?t=${t}`), getirJson(`${V4}?t=${t}`)]);
  const a = v1.status === 'fulfilled' ? v1.value : null;
  const b = v4.status === 'fulfilled' ? v4.value : null;
  if (!a && !b) throw new Error(`Truncgil v1 ve v4 erişilemedi (${v4.reason?.message || ''})`);
  const ogeler = [];
  for (const [kod, k4, k1, ad, tur, birim] of KALEMLER) {
    let alis = null, satis = null, degisim = null;
    const x4 = b?.[k4];
    if (x4 && Number(x4.Selling) > 0) { alis = Number(x4.Buying) || null; satis = Number(x4.Selling); degisim = Number(x4.Change); }
    const x1 = a?.[k1];
    if ((!satis || satis <= 0) && x1) { alis = trSayi(x1['Alış']); satis = trSayi(x1['Satış']); degisim = yuzde(x1['Değişim']); }
    if (satis > 0) ogeler.push({ kod, ad, tur, birim, alis, satis, degisimYuzde: degisim });
  }
  const kaynakZamani = (b?.Update_Date || a?.Update_Date || '').replace(' ', 'T');
  return { ogeler, ek: { kaynakGuncelleme: kaynakZamani ? `${kaynakZamani}+03:00` : null } };
}

/** B: ECB referans kurları (EUR tabanlı) -> TRY karşılıkları. Son ~10 gün çekilir, son iki iş günü karşılaştırılır. */
async function frankfurter() {
  const bas = new Date(Date.now() - 10 * 86400e3).toISOString().slice(0, 10);
  const j = await getirJson(`${FR}/${bas}..?base=EUR&symbols=TRY,USD,GBP`);
  const gunler = Object.keys(j?.rates || {}).sort();
  if (!gunler.length) throw new Error('Frankfurter boş yanıt');
  const tl = (r, kod) => (kod === 'EUR' ? r.TRY : r.TRY / r[kod]);
  const son = j.rates[gunler.at(-1)], once = gunler.length > 1 ? j.rates[gunler.at(-2)] : null;
  const ogeler = KALEMLER.filter(([kod]) => ['USD', 'EUR', 'GBP'].includes(kod)).map(([kod, , , ad, tur, birim]) => {
    const satis = Math.round(tl(son, kod) * 10000) / 10000;
    const onceki = once ? tl(once, kod) : null;
    return { kod, ad, tur, birim, alis: null, satis, degisimYuzde: onceki ? Math.round((satis / onceki - 1) * 10000) / 100 : null };
  });
  return {
    ogeler,
    ek: {
      kaynakGuncelleme: gunler.at(-1),
      not: 'Yedek kaynak: ECB günlük referans kuru (alış/satış ayrımı yok). Altın fiyatları bu kaynakta bulunmuyor.',
    },
  };
}

export async function main() {
  return planlarlaYaz(AD, [
    { kod: 'A', kaynak: 'Truncgil Finans', kaynakUrl: 'https://finans.truncgil.com/', calis: truncgil, enAz: 6 },
    { kod: 'B', kaynak: 'Frankfurter (ECB referans kurları)', kaynakUrl: 'https://frankfurter.dev', calis: frankfurter, enAz: 3 },
  ], {
    dogrula: (o) => o.satis > 0,
  });
}

calistir(import.meta, main);
