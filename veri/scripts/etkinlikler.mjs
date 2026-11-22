// Etkinlikler — Elazığ Belediyesi /etkinlikler/ sayfası (kategori başlıkları altında kartlar).
// Not: belediye bu bölümü seyrek güncelliyor (21.11.2026'da en yeni kayıt 12.05.2026). Afiş görselleri telif
// nedeniyle ALINMAZ; yalnız başlık, tarih, yer, kategori, bağlantı.
// A: bu sayfa. B: YOK (Elazığ için başka açık etkinlik listesi bulunamadı). C: önceki dosya korunur, durum:'eski'.
import { getir, temizle, trTarih, planlarlaYaz, bugunTR, calistir } from '../lib/ortak.mjs';

export const AD = 'etkinlikler';
const BEL = 'https://www.elazig.bel.tr';
const URL_ = `${BEL}/etkinlikler/`;

export function ayristir(html) {
  const harita = new Map();
  // Kategori başlıklarına göre böl: <h3>Konser <span><a href="/etkinlikler/konser">TÜMÜ</a></span></h3>
  const bolumler = html.split(/<h3>(?=[^<]*<span><a href="\/etkinlikler\/)/i);
  for (const b of bolumler) {
    const kategori = temizle(b.slice(0, b.indexOf('<span>'))) || null;
    const re = /<a href="(\/etkinlik\/[^"]+\/(\d+)\/)">[\s\S]*?class="day">(\d+)<[\s\S]*?class="month">([^<]+)<[\s\S]*?class="year">(\d+)<[\s\S]*?class="event-name">([\s\S]*?)<\/div>(?:\s*<div class="event-address[^"]*">([\s\S]*?)<\/div>)?/g;
    for (const m of b.matchAll(re)) {
      const [, yol, id, gun, ay, yil, ad, yer] = m;
      const o = harita.get(id) || {
        id: Number(id),
        baslik: temizle(ad),
        tarih: trTarih(gun, ay, yil),
        yer: temizle(yer || '') || null,
        kategoriler: [],
        baglanti: BEL + yol,
      };
      if (kategori && kategori.length < 40 && !o.kategoriler.includes(kategori)) o.kategoriler.push(kategori);
      harita.set(id, o);
    }
  }
  const bugun = bugunTR();
  return [...harita.values()]
    .map((o) => ({ ...o, gecmis: o.tarih ? o.tarih < bugun : null }))
    .sort((a, b) => (b.tarih || '').localeCompare(a.tarih || ''));
}

export async function main() {
  return planlarlaYaz(AD, [
    { kod: 'A', kaynak: 'Elazığ Belediyesi', kaynakUrl: URL_, calis: async () => ({ ogeler: ayristir((await getir(URL_)).text) }) },
  ], {
    ek: { not: 'gecmis=true olanlar tarihi geçmiş etkinliklerdir; belediye bu bölümü seyrek güncelliyor.' },
    dogrula: (o) => o.baslik && o.tarih && o.baglanti,
    enAz: 1,
  });
}

calistir(import.meta, main);
