// Su kesintileri — Elazığ Belediyesi yapılandırılmış bir "su kesintisi" listesi YAYINLAMIYOR (21.11.2026 kontrol:
// /su-kesintileri/ 404, duyurularda kesinti kaydı yok, belediye RSS'i 500 hatası veriyor).
// Bu yüzden YALNIZ belediyenin kendi /haberler/ ve /duyurular/ ilk sayfalarındaki BAŞLIKLARDAN anahtar kelimeyle
// süzme yapılır (haber sitelerinden hiçbir şey çekilmez). Çalıştırma başına 2 istek; detay sayfası açılmaz:
// tarih, listedeki görsel dosya adındaki zaman damgasından (_1795162278_ = yükleme anı) alınır; yoksa önceki dosyadaki
// tarih, o da yoksa ilk görülme anı kullanılır.
// Sonuç "resmî kesinti listesi" değil, "su kesintisiyle ilgili son belediye duyuruları"dır; uygulama bunu böyle etiketlemeli.
// A: belediye. B: YOK (başka resmî kaynak yok). C: önceki dosya korunur, durum:'eski'.
import { getir, varlikCoz, temizle, planlarlaYaz, oncekiniOku, bekle, calistir } from '../lib/ortak.mjs';

export const AD = 'su-kesintileri';
const BEL = 'https://www.elazig.bel.tr';
const GUN = 3; // son kaç günün duyuruları

export const SU_RE = /(su\s+kesinti|sular(?:ın)?\s+(?:kesil|ne\s+zaman|gel)|su\s+verilemey|suyu?\s+kesil|isale\s+hatt|içme\s+suyu[^.]{0,40}arıza|şebeke[^.]{0,30}arıza|susuz\s+kal)/i;

export function belListe(html) {
  const o = [];
  for (const m of html.matchAll(/<a href="(\/[a-z0-9-]+\/(\d+)\/)">([\s\S]{0,1500}?)<span>([^<]+)<\/span>/g)) {
    const ts = Number((m[3].match(/_(1[6-9]\d{8})_/) || [])[1]);
    o.push({ baglanti: BEL + m[1], baslik: varlikCoz(m[4]).trim(), tarih: ts ? new Date(ts * 1000).toISOString() : null });
  }
  return o;
}

async function belediye() {
  const onceki = await oncekiniOku(AD);
  const eskiTarih = new Map((onceki?.ogeler || []).map((x) => [x.baglanti, x.tarih]));
  const adaylar = [];
  let kaynakOk = 0;
  for (const [i, yol] of ['/haberler/', '/duyurular/'].entries()) {
    if (i) await bekle(1500);
    try {
      const liste = belListe((await getir(BEL + yol)).text);
      if (!liste.length) throw new Error('liste ayrıştırılamadı');
      kaynakOk++;
      for (const x of liste.filter((x) => SU_RE.test(x.baslik))) {
        adaylar.push({ ...x, kaynak: 'Elazığ Belediyesi', tarih: x.tarih || eskiTarih.get(x.baglanti) || new Date().toISOString() });
      }
    } catch (e) { console.warn(`  ! belediye ${yol}: ${e.message}`); }
  }
  if (!kaynakOk) throw new Error('belediye sayfalarına ulaşılamadı');
  const sinir = Date.now() - GUN * 86400e3;
  const gor = new Set();
  const ogeler = adaylar
    .filter((x) => Date.parse(x.tarih) >= sinir)
    .filter((x) => !gor.has(x.baglanti) && gor.add(x.baglanti))
    .sort((a, b) => b.tarih.localeCompare(a.tarih))
    .map(({ baslik, kaynak, tarih, baglanti }) => ({ baslik: temizle(baslik), kaynak, tarih, baglanti }));
  return { ogeler };
}

export async function main() {
  return planlarlaYaz(AD, [
    { kod: 'A', kaynak: 'Elazığ Belediyesi haber ve duyuruları (anahtar kelime süzgeci)', kaynakUrl: `${BEL}/duyurular/`, calis: belediye },
  ], {
    ek: {
      not: 'Resmî/yapılandırılmış su kesintisi listesi yok. Son 3 günde başlığında su kesintisi/arıza geçen belediye haber ve duyuruları. Belediyeyle (Beyaz Masa) teyit edilmeli.',
    },
    bosOlabilir: true, // kesinti yoksa boş liste doğru sonuçtur
    dogrula: (o) => o.baslik && o.baglanti,
  });
}

calistir(import.meta, main);
