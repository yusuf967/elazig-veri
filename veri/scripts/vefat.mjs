// Vefat / cenaze ilanları — Elazığ Belediyesi "Vefat Edenler" sayfası (son ~24 kayıt), yalnız 1. sayfa.
//  A: bu sayfa. B: YOK — belediyenin başka herkese açık vefat listesi yok (Mezarlık Bilgi Sistemi oturumlu bir CBS
//     uygulaması, liste değil; KVKK açısından da uygun değil). C: önceki dosya korunur, durum:'eski'.
// KVKK notu: belediyenin kamuya açık yayınladığı alanlar aynen alınır; uygulama bu veriyi saklamamalı/arşivlememeli,
// yalnız güncel listeyi göstermeli. Kaynak sayfa kaldırırsa bir sonraki çalıştırmada bizden de düşer.
import { getir, temizle, trTarihMetin, planlarlaYaz, calistir } from '../lib/ortak.mjs';

export const AD = 'vefat';
const URL_ = 'https://www.elazig.bel.tr/vefat-edenler/';

const ALANLAR = {
  'Adı Soyadı': 'ad',
  'Vefat Tarihi': 'vefatTarihiMetin',
  'Cenaze Sahibi': 'cenazeSahibi',
  'Defin Yeri': 'definYeri',
  'Taziye Bilgisi': 'taziye',
  'Cenaze Namazı': 'cenazeNamazi',
  'Namaz Vakti': 'cenazeNamazi',
};

export function ayristir(html) {
  const ogeler = [];
  const kartlar = html.split(/<div class="card-header deceased/i).slice(1);
  for (const k of kartlar) {
    const id = (k.match(/id="heading(\d+)"/) || [])[1] || null;
    const o = { id };
    for (const m of k.matchAll(/<td class="[^"]*font-bold">([^<:]+):?<\/td>\s*<td>([\s\S]*?)<\/td>/gi)) {
      const anahtar = ALANLAR[m[1].trim()];
      const deger = temizle(m[2]);
      if (anahtar && deger) o[anahtar] = deger;
      else if (!anahtar && deger) (o.diger ||= {})[m[1].trim()] = deger;
    }
    if (!o.ad) o.ad = temizle((k.match(/<strong>([\s\S]*?)<\/strong>/) || [])[1] || '');
    o.vefatTarihi = trTarihMetin(o.vefatTarihiMetin || '');
    delete o.vefatTarihiMetin;
    if (o.ad) ogeler.push(o);
  }
  return ogeler;
}

export async function main() {
  return planlarlaYaz(AD, [
    { kod: 'A', kaynak: 'Elazığ Belediyesi', kaynakUrl: URL_, calis: async () => ({ ogeler: ayristir((await getir(URL_)).text) }) },
  ], {
    dogrula: (o) => o.ad && o.vefatTarihi,
    enAz: 3,
  });
}

calistir(import.meta, main);
