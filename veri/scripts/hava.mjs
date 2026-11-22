// Hava durumu — MET Norway (Norveç Meteoroloji Enstitüsü) Locationforecast 2.0 + Sunrise 3.0.
// Lisans: CC BY 4.0 / NLOD, ticari kullanım serbest, "MET Norway" kaynağı gösterilmeli.
// Kullanım şartı: iletişim bilgisi içeren User-Agent, önbellek; mobil uygulamalar doğrudan değil
// bir ara katman üzerinden çağırmalı → bu betik (GitHub Actions) o ara katmandır.
// UA: kişisel bilgi YOK; yalnız (herkese açık) depo adı. MET_UA ortam değişkeniyle değiştirilebilir.
// Yedek kaynak yok (B yok): MET başarısızsa C planı — önceki dosya korunur, durum:'eski'.
// (Open-Meteo'nun ücretsiz katmanı ticari kullanıma kapalı olduğu için kullanılmıyor.)
import { bugunTR, ELAZIG, getirJson, planlarlaYaz, calistir } from '../lib/ortak.mjs';

export const AD = 'hava';
const FORECAST = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${ELAZIG.lat}&lon=${ELAZIG.lon}`;
const MET_UA = process.env.MET_UA || 'veri-okuyucu/1.0 github.com/elazig-veri';
const MET = { basliklar: { 'User-Agent': MET_UA } };
const SUN = (date) => `https://api.met.no/weatherapi/sunrise/3.0/sun?lat=${ELAZIG.lat}&lon=${ELAZIG.lon}&date=${date}&offset=+03:00`;

/** UTC ISO → Türkiye yerel "YYYY-MM-DDTHH:mm" (UTC+3, yaz saati yok). */
export const yerel = (iso) => new Date(new Date(iso).getTime() + 3 * 3600e3).toISOString().slice(0, 16);

/** Hissedilen sıcaklık: soğukta rüzgâr soğuğu (Kanada/ABD formülü), sıcakta basit ısı indeksi. */
export function hissedilen(t, ruzgarKmh, nem) {
  if (t <= 10 && ruzgarKmh > 4.8) {
    const v = ruzgarKmh ** 0.16;
    return 13.12 + 0.6215 * t - 11.37 * v + 0.3965 * t * v;
  }
  if (t >= 27 && nem >= 40) {
    // Steadman yaklaşımı (°C)
    const e = (nem / 100) * 6.105 * Math.exp((17.27 * t) / (237.7 + t));
    return t + 0.33 * e - 4.0;
  }
  return t;
}

const gunduzMu = (sembol, saat) => (sembol?.endsWith('_night') ? false : sembol?.endsWith('_day') ? true : saat >= 7 && saat < 18);

export function donustur(raw, gunes) {
  const ts = raw.properties.timeseries;
  const simdi = Date.now();
  // Şimdiki saate en yakın kayıt
  let i0 = ts.findIndex((t) => new Date(t.time).getTime() > simdi - 30 * 60e3);
  if (i0 < 0) i0 = 0;
  const kayit = (t) => {
    const d = t.data.instant.details;
    const sembol = t.data.next_1_hours?.summary.symbol_code ?? t.data.next_6_hours?.summary.symbol_code ?? 'cloudy';
    const yag = t.data.next_1_hours?.details?.precipitation_amount ?? 0;
    const zaman = yerel(t.time);
    return {
      time: zaman,
      temp: d.air_temperature,
      wind: Math.round(d.wind_speed * 3.6 * 10) / 10,
      humidity: Math.round(d.relative_humidity),
      symbol: sembol,
      rain: yag,
      day: gunduzMu(sembol, Number(zaman.slice(11, 13))),
    };
  };
  const now = kayit(ts[i0]);
  const hours = ts.slice(i0, i0 + 24).filter((t) => t.data.next_1_hours).map(kayit);

  // Günlük: yerel güne göre grupla
  const gunler = new Map();
  for (const t of ts) {
    const z = yerel(t.time);
    const g = z.slice(0, 10);
    if (!gunler.has(g)) gunler.set(g, { temps: [], yag: 0, semboller: [] });
    const o = gunler.get(g);
    o.temps.push(t.data.instant.details.air_temperature);
    o.yag += t.data.next_1_hours?.details?.precipitation_amount ?? 0;
    const saat = Number(z.slice(11, 13));
    const s = t.data.next_6_hours?.summary.symbol_code ?? t.data.next_1_hours?.summary.symbol_code;
    if (s && saat >= 9 && saat <= 15) o.semboller.push(s);
  }
  const days = [...gunler.entries()]
    .filter(([, o]) => o.temps.length >= 3)
    .slice(0, 7)
    .map(([date, o]) => ({
      date,
      symbol: (o.semboller[0] ?? 'cloudy').replace('_night', '_day'),
      max: Math.max(...o.temps),
      min: Math.min(...o.temps),
      rain: Math.round(o.yag * 10) / 10,
      sunrise: gunes[date]?.sunrise ?? null,
      sunset: gunes[date]?.sunset ?? null,
    }));

  return { now: { ...now, feels: Math.round(hissedilen(now.temp, now.wind, now.humidity) * 10) / 10 }, hours, days };
}

async function metGetir() {
  const raw = await getirJson(FORECAST, MET);
  const gunes = {};
  for (let i = 0; i < 2; i++) {
    const tarih = bugunTR(i);
    try {
      const s = await getirJson(SUN(tarih), MET);
      gunes[tarih] = { sunrise: s.properties.sunrise?.time?.slice(0, 16) ?? null, sunset: s.properties.sunset?.time?.slice(0, 16) ?? null };
    } catch {
      // gün doğumu verisi olmadan da yazılır
    }
  }
  const { now, hours, days } = donustur(raw, gunes);
  return { ogeler: hours, ek: { now, days, lisans: 'CC BY 4.0' } };
}

export async function main() {
  return planlarlaYaz(AD, [{ kod: 'A', kaynak: 'MET Norway', kaynakUrl: 'https://api.met.no', calis: metGetir }], {
    enAz: 12,
    dogrula: (o) => Number.isFinite(o.temp) && typeof o.symbol === 'string',
  });
}

calistir(import.meta, main);
