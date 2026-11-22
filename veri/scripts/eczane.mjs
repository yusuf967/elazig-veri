// Elazığ nöbetçi eczaneleri.
//  A : Elazığ Eczacı Odası resmi sayfası (ilçe başlıkları altında kartlar: ad, adres, telefon, Google Maps koordinatı).
//  B : eczaneler.gen.tr "Sitene Ekle" iframe'i (iframe.php?lokasyon=23). Sitenin kullanım koşulları "Sitene Ekle"
//      uygulaması üzerinden verilerin paylaşılabileceğini söylüyor; robots.txt bu yolu yasaklamıyor. Tüm ilçeler + koordinat.
//      (Kendisi de verileri eczacı odalarından derliyor; ayrı sunucu olduğu için oda sitesi düşünce işe yarar.)
//  B2: Elazığ Belediyesi /nobetci-eczaneler/ (kamu sayfası; yalnız Merkez, koordinat yok).
//  C : hiçbiri olmazsa önceki dosya korunur, durum:'eski'.
import { getir, temizle, bugunTR, trTarihMetin, AYLAR, planlarlaYaz, calistir } from '../lib/ortak.mjs';

export const AD = 'eczane';
const URL_A = 'https://www.elazigeczaciodasi.org.tr/nobetci-eczaneler/elazig';
const URL_B = 'https://www.eczaneler.gen.tr/iframe.php?lokasyon=23';
const URL_B_SAYFA = 'https://www.eczaneler.gen.tr/nobetci-elazig';
const URL_B2 = 'https://www.elazig.bel.tr/nobetci-eczaneler/';

const NOT = 'Hafta içi 18:00 - ertesi gün 08:30; Cumartesi 13:00 - Pazar 08:30; Pazar 08:30 - Pazartesi 08:30 (oda sayfasındaki açıklama). Listede olmayan ilçeler için oda sayfasına bakın.';
const buyuk = (s) => s.toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ').trim();
const rakam = (s) => (s || '').replace(/\D/g, '') || null;

export function ayristir(html) {
  const ogeler = [];
  // İlçe bölümlerine böl: <h4 id="title" class="pagetitle ...">ELAZIĞ - MERKEZ NÖBETÇİ ECZANELER</h4>
  const parcalar = html.split(/<h4[^>]*class="pagetitle[^"]*"[^>]*>/i).slice(1);
  for (const p of parcalar) {
    const baslik = temizle(p.slice(0, p.indexOf('</h4>')));
    const ilceM = baslik.match(/ELAZI[GĞ]\s*-\s*(.+?)\s+NÖBETÇİ/i);
    const ilce = ilceM ? ilceM[1].trim() : baslik;
    const kartlar = p.split(/<div class="col-md-12 nobetci">/i).slice(1);
    for (const k of kartlar) {
      const ad = temizle((k.match(/<h4 class="main-color"><strong>([\s\S]*?)<\/strong>/i) || [])[1] || '');
      const adresHam = (k.match(/fa-home[^>]*><\/i>([\s\S]*?)<br/i) || [])[1] || '';
      const telefon = rakam((k.match(/href="tel:([^"]+)"/i) || [])[1]);
      const koord = k.match(/maps\?q=(-?\d+\.\d+),(-?\d+\.\d+)/i);
      if (!ad) continue;
      ogeler.push({
        ilce,
        ad: ad.replace(/\s+ECZANES[İI]\s+ECZANES[İI]$/i, ' ECZANESİ').replace(/\s+/g, ' '),
        adres: temizle(adresHam),
        telefon,
        lat: koord ? Number(koord[1]) : null,
        lon: koord ? Number(koord[2]) : null,
      });
    }
  }
  return ogeler;
}

/** Nöbet günü bugün ya da dün değilse (gece yarısından sonra dünkü nöbet sürer) liste bayattır. */
function gunKontrol(gun) {
  if (!gun) throw new Error('nöbet tarihi okunamadı');
  if (gun !== bugunTR() && gun !== bugunTR(-1)) throw new Error(`liste ${gun} tarihli, bayat`);
  return gun;
}

/** B: eczaneler.gen.tr iframe tablosu. Her eczane: (ad + harita + ilçe) / telefon / adres satırları. */
export function ayristirB(html) {
  // Başlık: "21 Kasım Cumartesi" (yıl yok -> bugünün yılı; Aralık/Ocak geçişi düzeltilir)
  const bm = html.match(/<th[^>]*>\s*(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)/);
  let nobetGunu = null;
  if (bm) {
    const [yb, ab] = bugunTR().split('-').map(Number);
    const ay = AYLAR.indexOf(bm[2].toLocaleLowerCase('tr-TR')) + 1;
    if (ay > 0) {
      const yil = ab === 12 && ay === 1 ? yb + 1 : ab === 1 && ay === 12 ? yb - 1 : yb;
      nobetGunu = `${yil}-${String(ay).padStart(2, '0')}-${String(bm[1]).padStart(2, '0')}`;
    }
  }
  const ogeler = [];
  for (const b of html.split(/<span class='text-dark'><b>/i).slice(1)) {
    const ad = temizle(b.slice(0, b.indexOf('</b>')));
    const ilce = temizle((b.match(/<span class='text-secondary'>\(([^)]*)\)<\/span>/i) || [])[1] || '');
    const koord = b.match(/daddr=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const tel = (b.match(/telefon\.png'[^>]*><\/td><td>([^<]*)</i) || [])[1];
    const adres = (b.match(/adres\.png'[^>]*><\/td><td>([\s\S]*?)<\/td>/i) || [])[1];
    if (!ad) continue;
    ogeler.push({
      ilce: buyuk(ilce),
      ad: buyuk(ad),
      adres: temizle(adres || ''),
      telefon: rakam(tel),
      lat: koord ? Number(koord[1]) : null,
      lon: koord ? Number(koord[2]) : null,
    });
  }
  return { ogeler, nobetGunu };
}

/** B2: belediye sayfası kartları (yalnız Merkez). */
export function ayristirB2(html) {
  const ogeler = [];
  for (const m of html.matchAll(/<h4>([^<]*Eczanesi[^<]*)<\/h4>\s*<div class="pharmacy-address">([\s\S]*?)<\/div>\s*<div class="pharmacy-phone">([\s\S]*?)<\/div>/gi)) {
    ogeler.push({ ilce: 'MERKEZ', ad: buyuk(temizle(m[1])), adres: temizle(m[2]), telefon: rakam(m[3]), lat: null, lon: null });
  }
  // "<strong>21 Kasım 2026 günü mesai bitimi</strong>nden ..." -> nöbet günü
  const gm = html.match(/<strong>(\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+\d{4})\s+günü\s+mesai/i);
  return { ogeler, nobetGunu: gm ? trTarihMetin(gm[1]) : null };
}

export async function main() {
  return planlarlaYaz(AD, [
    {
      kod: 'A', kaynak: 'Elazığ Eczacı Odası', kaynakUrl: URL_A,
      calis: async () => ({ ogeler: ayristir((await getir(URL_A)).text), ek: { nobetGunu: bugunTR() } }),
    },
    {
      kod: 'B', kaynak: 'eczaneler.gen.tr', kaynakUrl: URL_B_SAYFA,
      calis: async () => {
        const { ogeler, nobetGunu } = ayristirB((await getir(URL_B)).text);
        return { ogeler, ek: { nobetGunu: gunKontrol(nobetGunu) } };
      },
    },
    {
      kod: 'B2', kaynak: 'Elazığ Belediyesi', kaynakUrl: URL_B2,
      enAz: 1,
      calis: async () => {
        const { ogeler, nobetGunu } = ayristirB2((await getir(URL_B2)).text);
        return { ogeler, ek: { nobetGunu: gunKontrol(nobetGunu), not: `${NOT} Bu yedek kaynak yalnız Merkez ilçesini listeler, koordinat yoktur.` } };
      },
    },
  ], {
    ek: { not: NOT },
    dogrula: (o) => o.ad && o.ilce && (o.telefon || o.adres),
    enAz: 2,
  });
}

calistir(import.meta, main);
