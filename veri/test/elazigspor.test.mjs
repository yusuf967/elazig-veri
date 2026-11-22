// Elazığspor ayrıştırıcı testleri (ağ yok; test/ornekler altındaki 22.11.2026 kayıtlarıyla).
// Çalıştırma: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  puanCoz, puanSatiriGecerli, fiksturCoz, kadroCoz, oyuncuCoz, macCoz, istatistikTopla,
  wikiKadroCoz, wikiPuanCoz, wikiEsle, takimAdi, bahissiz, formKodla, formAlanlari,
  olaylarCoz, olaylarGecerli, dakikaCoz, yayinCoz, yayinBul, kadroBoyutla,
} from '../scripts/elazigspor.mjs';

const oku = (ad) => readFileSync(new URL(`./ornekler/${ad}`, import.meta.url), 'utf8');

test('puan cetveli: 18 takım, Elazığspor 2. ve işaretli', () => {
  const { sezon, puanDurumu, ceza } = puanCoz(oku('tff-lig.html'));
  assert.equal(sezon, '2026-2027');
  assert.equal(puanDurumu.length, 18);
  assert.ok(puanDurumu.every(puanSatiriGecerli));
  const biz = puanDurumu.find((s) => s.biz);
  assert.deepEqual(biz, { sira: 2, takim: 'Elazığspor', o: 12, g: 8, b: 3, m: 1, a: 29, y: 8, av: 21, p: 27, biz: true });
  assert.equal(puanDurumu[0].takim, 'Muş Spor');
  assert.equal(puanDurumu.filter((s) => s.biz).length, 1);
  assert.ok(puanDurumu.find((s) => s.sira === 18).p < 0); // ceza puanlı takım eksi puanda
  assert.ok(ceza.some((c) => c.puan === 63));
});

test('fikstür: tarih, skor, ev/deplasman, sonraki sayfa hedefi, bahis adı yok', () => {
  const { maclar, sonrakiHedef } = fiksturCoz(oku('tff-fikstur.html'));
  assert.ok(maclar.length >= 10);
  const ilk = maclar[0];
  assert.equal(ilk.tarih, '2026-09-06');
  assert.equal(ilk.evSahibi, 'Elazığspor');
  assert.equal(ilk.ev, true);
  assert.equal(ilk.skor, '3-1');
  assert.equal(ilk.evGol, 3);
  assert.equal(ilk.macId, '318677');
  assert.equal(ilk.hafta, 1);
  assert.ok(maclar.every((m) => !/nesine/i.test(m.turnuva || '')));
  assert.match(ilk.turnuva, /^2\. Lig/);
  assert.match(sonrakiHedef, /grdFikstur\$ctl01\$ctl03\$ctl01\$ctl03$/);
});

test('kadro: oyuncu kimliği, ad (başlık harfi), kiralık', () => {
  const kadro = kadroCoz(oku('tff-kadro.html'));
  assert.equal(kadro.length, 27);
  assert.deepEqual(kadro[0], { id: '897776', ad: 'Abdurrahman Emir Alagöz' });
  const ali = kadro.find((o) => o.id === '1754246');
  assert.equal(ali.ad, 'Ali Yeşilyurt');
  assert.equal(ali.kiralik, 'Galatasaray');
});

test('oyuncu sayfası: doğum tarihi/yeri, uyruk', () => {
  assert.deepEqual(oyuncuCoz(oku('tff-oyuncu.html')), { dogum: '2005-07-30', dogumYeri: 'Küçükçekmece', uyruk: 'Türkiye' });
});

test('maç sayfası + istatistik: ilk 11, numara, gol, kart, giren', () => {
  const mac = macCoz(oku('tff-mac.html'));
  assert.equal(mac.tarih, '2026-11-18');
  assert.equal(mac.saat, '13:00');
  assert.equal(mac.stat, 'Elazığ Atatürk Stadyumu');
  assert.equal(mac.ev.kulupId, '37');
  assert.equal(mac.ev.ilk11.length, 11);
  assert.equal(mac.ev.yedek.length, 10);
  assert.deepEqual(mac.ev.ilk11[0], { id: '766034', numara: 77 });
  assert.equal(mac.ev.girenler.length, 3);
  assert.deepEqual(mac.ev.goller, [{ id: '1119772', kk: false }]);
  assert.equal(mac.ev.kartlar.length, 6);
  const ist = istatistikTopla([mac]);
  assert.deepEqual(
    { mac: ist['1119772'].mac, ilk11: ist['1119772'].ilk11, gol: ist['1119772'].gol },
    { mac: 1, ilk11: 1, gol: 0 + 1 },
  );
  assert.equal(ist['1802810'].mac, 1); // ALİ ALTINÖZ oyuna girdi
  assert.equal(ist['1802810'].ilk11, 0);
  assert.equal(ist['1802810'].sari, 1);
  assert.equal(ist['766034'].numara, 77);
  // rakip oyuncular sayılmaz
  assert.equal(Object.keys(ist).length, 21);
});

test('maç olayları: gol dakikası/atan, kart, adlı kadrolar, değişiklik, hakem', () => {
  const o = olaylarCoz(oku('tff-mac.html'));
  assert.ok(olaylarGecerli(o));
  assert.deepEqual(o.goller, [
    { dk: 13, oyuncu: 'Mert Örnek', takim: 'ev', id: '1119772' },
    { dk: 30, oyuncu: 'Doğukan Emeksiz', takim: 'dep' },
  ]);
  assert.equal(o.kadrolar.ev.ilk11.length, 11);
  assert.equal(o.kadrolar.ev.yedek.length, 10);
  assert.deepEqual(o.kadrolar.ev.ilk11[0], { no: 77, ad: 'Furkan Köse', id: '766034' });
  assert.ok(o.kadrolar.dep.ilk11.every((x) => !('id' in x) && x.ad && Number.isFinite(x.no))); // rakipte kimlik yok
  assert.deepEqual(o.kartlar.find((k) => k.oyuncu === 'Feyyaz Belen'), { dk: 64, oyuncu: 'Feyyaz Belen', takim: 'ev', renk: 'sari', id: '111545' });
  assert.equal(o.kartlar.length, 8);
  assert.ok(o.kartlar.every((k, i, a) => i === 0 || a[i - 1].dk + (a[i - 1].ek || 0) / 100 <= k.dk + (k.ek || 0) / 100)); // dakika sırası
  assert.deepEqual(o.degisiklikler.find((d) => d.giren === 'Ali Altınöz'),
    { dk: 60, takim: 'ev', giren: 'Ali Altınöz', girenId: '1802810', cikan: 'Muhammed Demirci', cikanId: '958783' });
  assert.equal(o.hakem, 'Berkay Ağış');
});

test('maç olayları: penaltı, çift sarı, uzatma dakikası (deplasman maçı)', () => {
  const o = olaylarCoz(oku('tff-mac-olay.html'));
  assert.equal(o.goller.length, 3);
  assert.ok(o.goller.every((g) => g.takim === 'dep' && g.id));
  assert.deepEqual(o.goller[0], { dk: 57, oyuncu: 'Enes Soy', takim: 'dep', id: '938777', tur: 'penalti' });
  assert.deepEqual(o.kartlar.find((k) => k.renk === 'sari-kirmizi'), { dk: 70, oyuncu: 'Abdulkadir Adıyaman', takim: 'ev', renk: 'sari-kirmizi' });
  assert.deepEqual(o.kartlar.at(-1), { dk: 90, ek: 3, oyuncu: 'Çağlayan Menderes', takim: 'dep', renk: 'sari', id: '1373277' });
  assert.equal(o.degisiklikler.length, 9);
  assert.ok(o.degisiklikler.every((d) => d.cikan));
  assert.deepEqual(dakikaCoz('90+2.dk'), { dk: 90, ek: 2 });
  assert.deepEqual(dakikaCoz(''), { dk: null });
  assert.equal(olaylarGecerli({ kadrolar: { ev: { ilk11: [] }, dep: { ilk11: [] } } }), false);
});

test('yayın tablosu: tarih, saat, kanal; Elazığspor maçını eşleme', () => {
  const satirlar = yayinCoz(oku('yayin-tablo.html'));
  assert.equal(satirlar.length, 18);
  assert.deepEqual(satirlar[1], { tarih: '2026-11-18', saat: '13:00', ev: 'Seza Çimento Elazığspor', dep: 'Menemen FK', kanal: 'Tivibu Spor 1' });
  assert.ok(satirlar.some((s) => s.kanal === 'Yaay'));
  assert.equal(yayinBul({ tarih: '2026-11-22', ev: false, evSahibi: 'Somaspor', deplasman: 'Elazığspor' }, satirlar), 'Tivibu Spor 1');
  assert.equal(yayinBul({ tarih: '2026-11-18', ev: true, evSahibi: 'Elazığspor', deplasman: 'Menemen' }, satirlar), 'Tivibu Spor 1');
  assert.equal(yayinBul({ tarih: '2026-11-29', ev: true, evSahibi: 'Elazığspor', deplasman: '68 Aksaray Belediye Spor' }, satirlar), null);
  assert.equal(yayinBul({ tarih: null, ev: true, evSahibi: 'Elazığspor', deplasman: 'X' }, satirlar), null);
  assert.deepEqual(yayinCoz('<table><tr><td>yok</td></tr></table>'), []);
});

test('boyut sınırı: eski maçların adlı kadroları atılır, olaylar kalır', () => {
  const kadrolar = { ev: { ilk11: [{ no: 1, ad: 'A'.repeat(200) }], yedek: [] }, dep: { ilk11: [], yedek: [] } };
  const fikstur = [
    { tarih: '2026-09-06', olaylar: { goller: [{ dk: 1 }], kadrolar: structuredClone(kadrolar) } },
    { tarih: '2026-11-18', olaylar: { goller: [], kadrolar: structuredClone(kadrolar) } },
  ];
  assert.equal(kadroBoyutla(fikstur, '2026-11-22', 1e6), 0); // sınırın altında: dokunma
  assert.ok(fikstur[0].olaylar.kadrolar);
  assert.equal(kadroBoyutla(fikstur, '2026-11-22', 100), 1);
  assert.equal(fikstur[0].olaylar.kadrolar, undefined);
  assert.deepEqual(fikstur[0].olaylar.goller, [{ dk: 1 }]);
  assert.ok(fikstur[1].olaylar.kadrolar);
});

test('Vikipedi kadrosu ve eşleme (mevki)', () => {
  const { kadro, guncel } = wikiKadroCoz(oku('wiki-kulup.txt'));
  assert.equal(guncel, '1 October 2026');
  assert.ok(kadro.length >= 25);
  const barıs = kadro.find((w) => w.ad === 'Barış Ekincier');
  assert.deepEqual(barıs, { ad: 'Barış Ekincier', numara: 7, mevki: 'Forvet', uyruk: 'Azerbaycan' });
  assert.equal(wikiEsle({ ad: 'Abdurrahman Emir Alagöz', numara: 5 }, kadro)?.mevki, 'Orta saha');
  assert.equal(wikiEsle({ ad: 'İsmail Esat Buğa', numara: 30 }, kadro)?.mevki, 'Orta saha');
  assert.equal(wikiEsle({ ad: 'Alp Ada Abay', numara: 35 }, kadro)?.mevki, 'Defans'); // yazım farkı, numara+soyad
  assert.equal(wikiEsle({ ad: 'Furkan Köse', numara: 77 }, kadro)?.mevki, 'Kaleci');
  assert.equal(wikiEsle({ ad: 'Hiç Olmayan', numara: 99 }, kadro), null);
});

test('Vikipedi puan tablosu (B planı): Elazığspor grubu, ceza puanı uygulanmış', () => {
  const { puanDurumu, guncel, grup } = wikiPuanCoz(oku('wiki-lig.txt'));
  assert.equal(grup, 'Beyaz');
  assert.equal(guncel, '31 October 2026');
  assert.equal(puanDurumu.length, 18);
  const biz = puanDurumu.find((s) => s.biz);
  assert.equal(biz.p, 19);
  assert.equal(biz.av, 15);
  const ads = puanDurumu.find((s) => s.takim === 'Adana Demirspor');
  assert.equal(ads.p, 7 - 51);
  assert.equal(ads.sira, 18);
});

test('yardımcılar', () => {
  assert.equal(bahissiz('Nesine 2. Lig Beyaz'), '2. Lig Beyaz');
  assert.equal(takimAdi('ALİAĞA FUTBOL A.Ş.'), 'Aliağa');
  assert.equal(takimAdi('ARKENT ARNAVUTKÖY BELEDİYESİ FUTBOL SK'), 'Arkent Arnavutköy Belediyesi');
  assert.equal(takimAdi('İNEGÖL KAFKAS SPOR KULÜBÜ'), 'İnegöl Kafkas Spor');
  assert.equal(takimAdi('MENEMEN FUTBOL KULÜBÜ'), 'Menemen');
  assert.equal(takimAdi('SEZA ÇİMENTO ELAZIĞSPOR', true), 'Elazığspor');
  assert.equal(formKodla('SEZA ÇİMENTO ş'), 'SEZA+%C7%DDMENTO+%FE');
  assert.equal(formKodla('a$b'), 'a%24b');
  const alanlar = formAlanlari(oku('tff-kulup-form.html'));
  assert.ok(alanlar.some(([k, v]) => k === 'ctl00$MPane$m_28_196_ctnr$m_28_196$cmbTakimlar_value' && v === 'P'));
  assert.ok(alanlar.some(([k]) => k === '__VIEWSTATE'));
});
