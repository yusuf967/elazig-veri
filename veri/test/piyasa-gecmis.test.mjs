import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anlikGoruntu, birlestir, frankfurterCevir, oneEkle, seyrelt, yerelSatislar } from '../scripts/piyasa-gecmis.mjs';

const DK = 60, SAAT = 3600, GUN = 86400;
// 2026-11-22 12:00 TR
const SIMDI = Date.parse('2026-11-22T09:00:00Z') / 1000;

test('seyreltme: son 2 gün 30 dk, 30 gün saatlik, 2 yıl günlük', () => {
  const noktalar = [];
  // son 3 saat, 10 dakikada bir -> 30 dk dilimlerinde son nokta kalır
  for (let t = SIMDI - 3 * SAAT + 10 * DK; t <= SIMDI; t += 10 * DK) noktalar.push([t, t]);
  // 10 gün önce, aynı saatte 15 dk arayla 4 nokta -> saatlik dilimde 1
  const on = SIMDI - 10 * GUN;
  const onSaat = on - ((on + 3 * SAAT) % SAAT); // TR saat başı
  for (let i = 0; i < 4; i++) noktalar.push([onSaat + i * 15 * DK, 100 + i]);
  // 200 gün önce aynı gün içinde 3 nokta -> 1
  const iki = SIMDI - 200 * GUN;
  const gunBasi = iki - ((iki + 3 * SAAT) % GUN);
  noktalar.push([gunBasi + 2 * SAAT, 1], [gunBasi + 10 * SAAT, 2], [gunBasi + 20 * SAAT, 3]);
  // 3 yıl önce -> atılır; gelecekte -> atılır; bozuk -> atılır
  noktalar.push([SIMDI - 1100 * GUN, 5], [SIMDI + 5 * SAAT, 5], [SIMDI - 100, null], [SIMDI - 50, -1]);

  const s = seyrelt(noktalar, SIMDI);
  const son3 = s.filter((n) => SIMDI - n[0] <= 3 * SAAT);
  assert.equal(son3.length, 7); // 09:10-12:00 arası: 09:00 … 11:30 dilimleri (6) + 12:00 kendi diliminde
  assert.deepEqual(s.filter((n) => n[1] >= 100 && n[1] < 104), [[onSaat + 45 * DK, 103]]);
  assert.deepEqual(s.filter((n) => n[1] <= 3), [[gunBasi + 20 * SAAT, 3]]);
  assert.ok(!s.some((n) => n[1] === 5 || n[1] === -1));
  // sıralı ve yeniden uygulanınca değişmez
  assert.deepEqual(seyrelt(s, SIMDI), s);
  for (let i = 1; i < s.length; i++) assert.ok(s[i][0] > s[i - 1][0]);
});

test('dilim katman değişince birleşir (30 dk -> saatlik)', () => {
  const t0 = SIMDI - 3 * GUN;
  const saatBasi = t0 - ((t0 + 3 * SAAT) % SAAT);
  const s = seyrelt([[saatBasi + 5 * DK, 1], [saatBasi + 35 * DK, 2]], SIMDI);
  assert.deepEqual(s, [[saatBasi + 35 * DK, 2]]);
});

const PIYASA = {
  durum: 'guncel',
  guncelleme: new Date((SIMDI - 2 * DK) * 1000).toISOString(),
  ogeler: [
    { kod: 'USD', satis: 50.57524 },
    { kod: 'GRAM', satis: 5731.951 },
    { kod: 'CEYREK', satis: 9500 },
    { kod: 'GUMUS', satis: 70.1 },
    { kod: 'ONS', satis: 3500 },
  ],
};
const YEREL = { ogeler: [{ kod: 'gram-altin', satis: 6291.23 }, { kod: 'gram-has-altin', satis: 6081.23 }, { kod: 'ceyrek-altin', satis: 10100 }, { kod: 'yarim-altin', satis: 20200 }] };

test('anlık görüntü: kod eşleme, yerel öncelikli, yuvarlama', () => {
  assert.deepEqual(anlikGoruntu(PIYASA, YEREL, SIMDI), {
    'gram-altin': 6291.23,
    'ceyrek-altin': 10100,
    'yarim-altin': 20200,
    'gram-has-altin': 6081.23,
    gumus: 70.1,
    USD: 50.5752,
  });
  // yerel 4 kalemden azsa genel piyasa
  assert.equal(anlikGoruntu(PIYASA, { ogeler: YEREL.ogeler.slice(0, 3) }, SIMDI)['gram-altin'], 5731.95);
  assert.equal(yerelSatislar({ ogeler: [{ kod: 'x', satis: 0 }] }), null);
});

test('anlık görüntü: eski ya da başarısız piyasa dosyası yok sayılır', () => {
  assert.equal(anlikGoruntu({ ...PIYASA, durum: 'eski' }, null, SIMDI), null);
  assert.equal(anlikGoruntu({ ...PIYASA, guncelleme: new Date((SIMDI - 2 * SAAT) * 1000).toISOString() }, null, SIMDI), null);
  assert.equal(anlikGoruntu(null, null, SIMDI), null);
});

test('Frankfurter çevirisi: EUR tabanından TL karşılığı', () => {
  const g = frankfurterCevir({ rates: { '2024-11-04': { TRY: 37.4528, USD: 1.0904, GBP: 0.84063 }, '2024-11-01': { TRY: 37.3758, USD: 1.0885, GBP: 0.83998 }, bozuk: { TRY: 1 } } });
  const t = Date.parse('2024-11-01T15:00:00Z') / 1000;
  assert.deepEqual(g.EUR[0], [t, 37.3758]);
  assert.deepEqual(g.USD[0], [t, 34.3370]);
  assert.deepEqual(g.GBP[0], [t, 44.4961]);
  assert.equal(g.USD.length, 2);
  assert.ok(g.USD[0][0] < g.USD[1][0]);
});

test('geri doldurma yalnız ilk gerçek ölçümden önce', () => {
  assert.deepEqual(oneEkle([[100, 5], [200, 6]], [[50, 1], [100, 2], [150, 3]]), [[50, 1], [100, 5], [200, 6]]);
  assert.deepEqual(oneEkle([], [[50, 1]]), [[50, 1]]);
});

test('birleştirme: önceki + görüntü + geri doldurma', () => {
  const onceki = { USD: [[SIMDI - 30 * DK, 50.5]], bilinmeyen: [[SIMDI, 1]] };
  const geri = { USD: [[SIMDI - 5 * GUN, 49.9], [SIMDI - 10 * DK, 99]] };
  const k = birlestir(onceki, { USD: 50.6, 'gram-altin': 6300 }, SIMDI, geri);
  assert.deepEqual(k.USD, [[SIMDI - 5 * GUN, 49.9], [SIMDI - 30 * DK, 50.5], [SIMDI, 50.6]]);
  assert.deepEqual(k['gram-altin'], [[SIMDI, 6300]]);
  assert.equal(k.bilinmeyen, undefined);
  assert.equal(k.EUR, undefined);
});
