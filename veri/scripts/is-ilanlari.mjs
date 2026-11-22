// İş ilanları.
//  A: İŞKUR e-Şube "Açık İş İlanı Ara" (üyeliksiz, herkese açık arama; robots.txt Allow: /).
//     ASP.NET WebForms: form sayfası açılır, gizli alanlar (__VIEWSTATE vb.) alınır, İl=23 (Elazığ) ile "Ara" postback'i
//     yapılır, sonra "Sonraki Sayfa" postback'leri. Siteyi zorlamamak için EN FAZLA 3 sonuç sayfası (sayfa başı 15 ilan),
//     her istek arasında 1,5 sn bekleme. Her satırdaki data-* öznitelikleri okunur. İşyeri adı üyelik istediği için gelmez.
//  B: İŞKUR Açık İş Haritası (harita.iskur.gov.tr, sitenin kendi JSON ucu, tek istek). Tek tek ilan DEĞİL,
//     ilçe × meslek bazında açık pozisyon toplamları verir. Aynı şemaya eşlenir: ilanNo = "H-<ilçeKod>-<meslekNo>"
//     (gerçek ilan no değil), pozisyonSayisi = toplam, sonBasvuru/isverenTuru/calismaSekli = null,
//     baglanti = İŞKUR arama sayfası. Üst alanda "not" bunu açıklar.
//  C: önceki dosya korunur, durum:'eski'.
import { getir, getirJson, varlikCoz, noktaliTarih, baslikHarfi, bekle, planlarlaYaz, calistir } from '../lib/ortak.mjs';

export const AD = 'is-ilanlari';
const URL_ = 'https://esube.iskur.gov.tr/Istihdam/AcikIsIlanAra.aspx';
const DETAY = 'https://esube.iskur.gov.tr/Istihdam/AcikIsIlanDetay.aspx?uiID=';
const IL = '23';
const HARITA = 'https://harita.iskur.gov.tr/umbraco/api/istihdam/il/23';
const HARITA_SAYFA = 'https://harita.iskur.gov.tr/acik-is-haritasi/';
const EN_FAZLA_SAYFA = 3;
const ARA = 1500; // istekler arası bekleme (ms)
const NOT_A = 'İşyeri adı İŞKUR üyeliği gerektirdiği için yoktur; başvuru bağlantıdan İŞKUR üzerinden yapılır.';

function gizliAlanlar(html) {
  const f = new URLSearchParams();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"/g)) f.set(m[1], varlikCoz(m[2]));
  return f;
}

export function ayristir(html) {
  const ogeler = [];
  for (const m of html.matchAll(/class="dropdown-toggle share-toggle"([\s\S]*?)>/g)) {
    const a = {};
    for (const x of m[1].matchAll(/data-([a-z]+)='([^']*)'/g)) a[x[1]] = varlikCoz(x[2]).replace(/\s+/g, ' ').trim();
    if (!a.ilanno) continue;
    ogeler.push({
      ilanNo: a.ilanno,
      meslek: a.meslekler || null,
      pozisyonSayisi: a.acikissayi ? Number(a.acikissayi) : null,
      isverenTuru: a.isverentur || null, // Özel / Kamu
      calismaSekli: a.calismasekli || null,
      calismaYeri: a.il || null,
      sonBasvuru: noktaliTarih(a.sontarih || ''),
      baglanti: DETAY + a.ilanno,
    });
  }
  return ogeler;
}

async function postBack(form, cerez, hedef) {
  form.set('__EVENTTARGET', hedef);
  form.set('__EVENTARGUMENT', '');
  form.set('ctl04$ctlIl', IL);
  const { text } = await getir(URL_, {
    yontem: 'POST',
    govde: form,
    basliklar: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cerez },
    deneme: 1, // postback yeniden gönderilmez
  });
  return text;
}

async function esube() {
  const { text: formHtml, res: r1 } = await getir(URL_);
  const cerez = (r1.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  await bekle(ARA);
  let html = await postBack(gizliAlanlar(formHtml), cerez, 'ctl04$ctlAcikIsPageCommand$CommandItem_Search');
  const toplam = Number((html.match(/Toplam Kayıt:\s*(\d+)/) || [])[1] || 0);
  const tum = ayristir(html);
  for (let s = 2; s <= EN_FAZLA_SAYFA && /ctlDataPagerDetay\$btnNext/.test(html) && !/btnNext" class="aspNetDisabled/.test(html); s++) {
    await bekle(ARA);
    try {
      html = await postBack(gizliAlanlar(html), cerez, 'ctl04$ctlDataPagerDetay$btnNext');
      const o = ayristir(html);
      if (!o.length) break;
      tum.push(...o);
    } catch (e) { console.warn(`  ! sayfa ${s}: ${e.message}`); break; }
  }
  const gor = new Set();
  const ogeler = tum.filter((o) => !gor.has(o.ilanNo) && gor.add(o.ilanNo))
    .sort((a, b) => (a.sonBasvuru || '').localeCompare(b.sonBasvuru || ''));
  // Yanlış il gelirse (site değişirse) yazma.
  const elazigOrani = ogeler.filter((o) => /ELAZI/i.test(o.calismaYeri || '')).length / (ogeler.length || 1);
  if (elazigOrani < 0.8) throw new Error(`ilanların yalnız %${Math.round(elazigOrani * 100)}'i Elazığ; filtre çalışmamış olabilir`);
  const not = toplam > ogeler.length
    ? `${NOT_A} Toplam ${toplam} ilanın ilk ${ogeler.length} tanesi (en fazla ${EN_FAZLA_SAYFA} sayfa) alınır; tamamı için İŞKUR sayfasına bakın.`
    : NOT_A;
  return { ogeler, ek: { toplamKayit: toplam || null, not } };
}

/** B: Açık İş Haritası il JSON'u -> ilçe × meslek özet satırları */
export function haritaDonustur(j) {
  if (!/ELAZI/i.test(j?.il || '')) throw new Error(`beklenmeyen il: ${j?.il}`);
  const ogeler = [];
  for (const i of j.ilceler || []) {
    for (const m of i.meslekler || []) {
      if (!m.meslek || !(m.sayi > 0)) continue;
      ogeler.push({
        ilanNo: `H-${i.ilceKod}-${m.meslekKayitNo}`,
        meslek: baslikHarfi(m.meslek),
        pozisyonSayisi: m.sayi,
        isverenTuru: null,
        calismaSekli: null,
        calismaYeri: `ELAZIĞ / ${i.ilce}`,
        sonBasvuru: null,
        baglanti: URL_,
      });
    }
  }
  ogeler.sort((a, b) => b.pozisyonSayisi - a.pozisyonSayisi || a.meslek.localeCompare(b.meslek, 'tr'));
  return { ogeler, toplam: j.ilToplam ?? null };
}

async function harita() {
  const { ogeler, toplam } = haritaDonustur(await getirJson(HARITA));
  return {
    ogeler,
    ek: {
      toplamKayit: toplam,
      not: 'Yedek kaynak (İŞKUR Açık İş Haritası): tek tek ilan değil, ilçe ve meslek bazında açık pozisyon toplamlarıdır. ilanNo gerçek ilan numarası değildir; son başvuru tarihi ve işveren türü yoktur. İlanların kendisi için İŞKUR arama sayfasını açın.',
    },
  };
}

export async function main() {
  return planlarlaYaz(AD, [
    { kod: 'A', kaynak: 'İŞKUR e-Şube', kaynakUrl: URL_, calis: esube },
    { kod: 'B', kaynak: 'İŞKUR Açık İş Haritası', kaynakUrl: HARITA_SAYFA, calis: harita },
  ], {
    dogrula: (o) => o.ilanNo && o.meslek,
    enAz: 1,
  });
}

calistir(import.meta, main);
