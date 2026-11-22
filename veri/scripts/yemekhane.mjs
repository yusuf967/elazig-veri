// Fırat Üniversitesi haftalık yemek menüsü — SKS Daire Başkanlığı sitesindeki "Yemek Menüsü" bağlantısının
// gösterdiği sayfa (unievi.firat.edu.tr). Hafta içi 5 gün; her yemek için tür, ad, kalori ve makrolar.
// A: bu sayfa. B: YOK (sks.firat.edu.tr betiklere 403 veriyor, başka açık menü kaynağı yok). C: önceki dosya, durum:'eski'.
import { getir, temizle, trTarihMetin, planlarlaYaz, calistir } from '../lib/ortak.mjs';

export const AD = 'yemekhane';
const URL_ = 'https://unievi.firat.edu.tr/tr';

const sayi = (s) => {
  const m = (s || '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

export function ayristir(html) {
  const gunler = [];
  const paneller = html.split(/<section class="fm-panel"/i).slice(1);
  for (const p of paneller) {
    const govde = p.slice(0, p.indexOf('</section>') > 0 ? p.indexOf('</section>') : undefined);
    const bas = govde.match(/<div class="fm-heading">[\s\S]*?<small>([\s\S]*?)<\/small>[\s\S]*?<h3>([\s\S]*?)<\/h3>/i);
    const tarih = bas ? trTarihMetin(temizle(bas[1])) : null;
    const gun = bas ? temizle(bas[2]).replace(/\s*Menüsü$/i, '') : null;
    const yemekler = [];
    for (const d of govde.split(/<div class="fm-dish">/i).slice(1)) {
      const tur = temizle((d.match(/<div class="fm-details">\s*<small>([\s\S]*?)<\/small>/i) || [])[1] || '');
      const ad = temizle((d.match(/<strong>([\s\S]*?)<\/strong>/i) || [])[1] || '');
      const nut = (ad2) => sayi((d.match(new RegExp(`${ad2}\\s*<b>([^<]+)</b>`, 'i')) || [])[1]);
      const kalori = sayi(temizle((d.match(/<div class="fm-energy">([\s\S]*?)<\/div>/i) || [])[1] || ''));
      if (ad) yemekler.push({ tur: tur || null, ad, kalori, protein: nut('Protein'), karbonhidrat: nut('Karbonhidrat'), yag: nut('Yağ') });
    }
    if (tarih && yemekler.length) {
      gunler.push({
        tarih,
        gun,
        yemekler,
        toplamKalori: yemekler.reduce((t, y) => t + (y.kalori || 0), 0) || null,
      });
    }
  }
  return gunler;
}

export async function main() {
  return planlarlaYaz(AD, [
    { kod: 'A', kaynak: 'Fırat Üniversitesi SKS (Yemek Menüsü)', kaynakUrl: URL_, calis: async () => ({ ogeler: ayristir((await getir(URL_)).text) }) },
  ], {
    dogrula: (o) => o.tarih && o.yemekler.length,
    enAz: 1,
  });
}

calistir(import.meta, main);
