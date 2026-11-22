// Son depremler (Elazığ merkezli 150 km, son 7 gün).
//  A: AFAD açık deprem API'si. AFAD "date" alanı UTC'dir (EMSC ile karşılaştırılarak doğrulandı); sonuna Z eklenir.
//  B: EMSC SeismicPortal FDSN olay servisi (CC BY 4.0, ticari kullanım atıfla serbest). Türkçe il/ilçe adı yok:
//     yer = EMSC Flinn-Engdahl bölge adı ("EASTERN TURKEY"), il/ilce/mahalle = null.
//     (Kandilli bilerek kullanılmıyor: sitesi "yazılı izin olmadan ticari amaçlı kullanılamaz" diyor.)
//  C: önceki dosya korunur, durum:'eski'.
// Uygulama AFAD'ı DOĞRUDAN da çağırabilir (bkz. README); bu ayna web (CORS/WAF) ve AFAD düşerse yedek içindir.
import { getir, getirJson, uzaklikKm, ELAZIG, planlarlaYaz, calistir } from '../lib/ortak.mjs';

export const AD = 'deprem';
const UC_A = 'https://servisnet.afad.gov.tr/apigateway/deprem/apiv2/event/filter';
const UC_B = 'https://www.seismicportal.eu/fdsnws/event/1/query';
const YARICAP_M = 150000;
const GUN = 7;

const utc = (d) => d.toISOString().slice(0, 19); // YYYY-MM-DDTHH:mm:ss (UTC)
const uzak = (enlem, boylam) => Math.round(uzaklikKm(ELAZIG.lat, ELAZIG.lon, enlem, boylam));

export function donustur(liste) {
  return liste.map((e) => {
    const enlem = Number(e.latitude), boylam = Number(e.longitude);
    return {
      id: String(e.eventID),
      tarih: `${e.date}Z`,
      buyukluk: Number(e.magnitude),
      tip: e.type,
      derinlikKm: Number(e.depth),
      enlem,
      boylam,
      yer: e.location,
      il: e.province || null,
      ilce: e.district || null,
      mahalle: e.neighborhood || null,
      uzaklikKm: uzak(enlem, boylam),
    };
  });
}

const TIP = { ml: 'ML', mw: 'Mw', mb: 'mb', md: 'MD', ms: 'Ms', mww: 'Mww' };

/** EMSC GeoJSON -> aynı şema */
export function donusturB(geojson) {
  return (geojson.features || []).map((f) => {
    const p = f.properties;
    const enlem = Number(p.lat), boylam = Number(p.lon);
    return {
      id: `EMSC-${p.unid || f.id}`,
      tarih: `${String(p.time).slice(0, 19)}Z`,
      buyukluk: Number(p.mag),
      tip: TIP[String(p.magtype || '').toLowerCase()] || String(p.magtype || '').toUpperCase(),
      derinlikKm: Number(p.depth),
      enlem,
      boylam,
      yer: p.flynn_region || '',
      il: null,
      ilce: null,
      mahalle: null,
      uzaklikKm: uzak(enlem, boylam),
    };
  }).filter((o) => o.uzaklikKm <= YARICAP_M / 1000);
}

export async function main() {
  const bitis = new Date();
  const baslangic = new Date(bitis.getTime() - GUN * 86400e3);
  const sirala = (o) => o.sort((a, b) => b.tarih.localeCompare(a.tarih)).slice(0, 300);
  return planlarlaYaz(AD, [
    {
      kod: 'A', kaynak: 'AFAD Deprem Dairesi', kaynakUrl: 'https://deprem.afad.gov.tr/last-earthquakes',
      calis: async () => {
        const liste = await getirJson(`${UC_A}?start=${utc(baslangic)}&end=${utc(bitis)}&lat=${ELAZIG.lat}&lon=${ELAZIG.lon}&maxrad=${YARICAP_M}&orderby=timedesc`);
        if (!Array.isArray(liste)) throw new Error('AFAD dizi döndürmedi');
        return { ogeler: sirala(donustur(liste)) };
      },
    },
    {
      kod: 'B', kaynak: 'EMSC-CSEM SeismicPortal', kaynakUrl: 'https://www.seismicportal.eu',
      calis: async () => {
        // maxradius derece cinsinden: 150 km ≈ 1,36°; ardından haversine ile 150 km'ye kırpılır.
        const { text, res } = await getir(`${UC_B}?format=json&lat=${ELAZIG.lat}&lon=${ELAZIG.lon}&maxradius=1.36&starttime=${utc(baslangic)}&orderby=time&limit=500`);
        const j = res.status === 204 || !text.trim() ? { features: [] } : JSON.parse(text); // FDSN: olay yoksa 204
        if (!Array.isArray(j?.features)) throw new Error('EMSC GeoJSON döndürmedi');
        return { ogeler: sirala(donusturB(j)), ek: { lisans: 'CC BY 4.0' } };
      },
    },
  ], {
    ek: { merkez: ELAZIG, yaricapKm: YARICAP_M / 1000, gun: GUN },
    bosOlabilir: true, // 7 günde hiç deprem olmaması mümkün (bölgede pek olası değil ama geçerli)
    dogrula: (o) => o.id && Number.isFinite(o.buyukluk) && Number.isFinite(o.enlem),
  });
}

calistir(import.meta, main);
