// Planlı elektrik kesintileri — Fırat EDAŞ "Bakım Programı ve Kesinti Listesi" sayfasının kendi AJAX ucu.
// Uç: GET https://www.firatedas.com.tr/BilgiDanisma/GetKesintiler?yil=YYYY&ay=M&il=23&ilce=
// HTML <tr> satırları döner: İl | İlçe | Tarih | Başlama | Bitiş | Neden | Etkilenecek Bölge | Eklenme Tarihi
// Aynı (ilçe, tarih, saat, neden) satırları tek kayıtta birleştirilir, bölgeler dizi olur.
// İstek: çalıştırma başına 2 (bu ay + gelecek ay), aralarında 1,5 sn.
// A: bu uç. B: YOK — Fırat EDAŞ'ın başka herkese açık kesinti ucu/sayfası yok (yalnız bu liste; .xls dışa aktarımı
//    robots.txt ile yasak), e-Devlet'te Fırat EDAŞ planlı kesinti sorgusu yok. C: önceki dosya korunur, durum:'eski'.
import { getir, temizle, noktaliTarih, planlarlaYaz, bugunTR, bekle, calistir } from '../lib/ortak.mjs';

export const AD = 'elektrik-kesintileri';
const SAYFA = 'https://www.firatedas.com.tr/BilgiDanisma/BakimProgramiveKesintiListesi';
const UC = 'https://www.firatedas.com.tr/BilgiDanisma/GetKesintiler';
const IL_KODU = 23; // Elazığ

export function ayristir(html) {
  const satirlar = [];
  for (const m of html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const h = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => temizle(x[1]));
    if (h.length < 7) continue;
    const [il, ilce, tarih, bas, bit, neden, bolge, eklenme] = h;
    const t = noktaliTarih(tarih);
    if (!t) continue;
    satirlar.push({ il, ilce, tarih: t, baslangic: bas, bitis: bit, neden, bolge, eklenme: noktaliTarih(eklenme || '') });
  }
  return satirlar;
}

function birlestir(satirlar) {
  const harita = new Map();
  for (const s of satirlar) {
    const k = [s.ilce, s.tarih, s.baslangic, s.bitis, s.neden].join('|');
    let o = harita.get(k);
    if (!o) {
      o = {
        ilce: s.ilce,
        tarih: s.tarih,
        baslangic: s.baslangic,
        bitis: s.bitis,
        // ISO, Türkiye saati (+03:00)
        baslangicIso: /^\d{2}:\d{2}$/.test(s.baslangic) ? `${s.tarih}T${s.baslangic}:00+03:00` : null,
        bitisIso: /^\d{2}:\d{2}$/.test(s.bitis) ? `${s.tarih}T${s.bitis}:00+03:00` : null,
        neden: s.neden,
        bolgeler: [],
        eklenme: s.eklenme,
      };
      harita.set(k, o);
    }
    if (s.bolge && !o.bolgeler.includes(s.bolge)) o.bolgeler.push(s.bolge);
  }
  return [...harita.values()].sort((a, b) =>
    (a.baslangicIso || a.tarih).localeCompare(b.baslangicIso || b.tarih) || a.ilce.localeCompare(b.ilce, 'tr'));
}

async function firatEdas() {
  // Bu ay + gelecek ay (ay sonuna yakın planlananlar için).
  const bugun = bugunTR();
  const [y, a] = bugun.split('-').map(Number);
  const aylar = [[y, a], a === 12 ? [y + 1, 1] : [y, a + 1]];
  let satirlar = [];
  let basarili = 0;
  for (const [i, [yil, ay]] of aylar.entries()) {
    if (i) await bekle(1500);
    try {
      const { text } = await getir(`${UC}?yil=${yil}&ay=${ay}&il=${IL_KODU}&ilce=`, { basliklar: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!/<th[^>]*>[\s\S]*?İlçe/i.test(text) && !/<tr>/i.test(text)) throw new Error('beklenmeyen yanıt');
      satirlar.push(...ayristir(text));
      basarili++;
    } catch (e) {
      console.warn(`  ! ${yil}-${ay}: ${e.message}`);
    }
  }
  if (!basarili) throw new Error('Fırat EDAŞ ucuna ulaşılamadı');
  // Yalnız bugün ve sonrası.
  satirlar = satirlar.filter((s) => s.tarih >= bugun && /ELAZI/i.test(s.il));
  return { ogeler: birlestir(satirlar) };
}

export async function main() {
  return planlarlaYaz(AD, [{ kod: 'A', kaynak: 'Fırat EDAŞ', kaynakUrl: SAYFA, calis: firatEdas }], {
    // Planlı kesinti olmayan günler mümkün; uç başarıyla yanıt verdiyse boş liste geçerli.
    bosOlabilir: true,
    dogrula: (o) => o.ilce && o.tarih && o.bolgeler.length,
  });
}

calistir(import.meta, main);
