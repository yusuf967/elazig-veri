// Tüm veri betiklerini sırayla çalıştırır; biri patlarsa diğerleri devam eder.
// Kullanım:
//   node run-all.mjs                 -> hepsi
//   node run-all.mjs eczane vefat    -> yalnız adı verilenler
//   node run-all.mjs --grup sik      -> GRUPLAR.sik içindekiler
// Sonunda public/durum.json yazılır (her betiğin son başarılı zamanı, kullanılan plan ve son hatası) — uygulama bayatlığı
// buradan ya da her dosyadaki "durum"/"sonBasari" alanlarından gösterebilir.
// Betikler arasında kısa bekleme vardır (aynı siteye art arda yüklenmemek için).
// Çıkış kodu: hepsi başarısızsa 1, aksi halde 0 (kısmi hata iş akışını kırmasın; durum.json'a yazılır).
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { PUBLIC, bekle } from './lib/ortak.mjs';

export const BETIKLER = [
  'eczane',
  'elektrik-kesintileri',
  'su-kesintileri',
  'vefat',
  'is-ilanlari',
  'yemekhane',
  'etkinlikler',
  'deprem',
  'piyasa',
  'piyasa-gecmis',
  'hava',
  'elazigspor',
];

// Sıklıklar .github/workflows/veri.yml'deki cron satırlarıyla eşleşir.
export const GRUPLAR = {
  sik: ['deprem', 'piyasa', 'piyasa-gecmis', 'hava'], // 30 dk (açık API'ler); piyasa-gecmis piyasa'dan SONRA (onun dosyasını okur)
  eczane: ['eczane'], // günde 3
  orta: ['elektrik-kesintileri'], // 3 saatte bir
  seyrek: ['vefat', 'is-ilanlari', 'etkinlikler', 'su-kesintileri', 'yemekhane'], // 6 saatte bir
  gunluk: ['elazigspor'], // günde 1 (TR 06:30)
};

function secilenler(argv) {
  const g = argv.indexOf('--grup');
  if (g >= 0) {
    const ad = argv[g + 1];
    if (!GRUPLAR[ad]) throw new Error(`Bilinmeyen grup: ${ad} (var olanlar: ${Object.keys(GRUPLAR).join(', ')})`);
    return GRUPLAR[ad];
  }
  const adlar = argv.filter((a) => !a.startsWith('--'));
  for (const a of adlar) if (!BETIKLER.includes(a)) throw new Error(`Bilinmeyen betik: ${a}`);
  return adlar.length ? adlar : BETIKLER;
}

async function main() {
  const liste = secilenler(process.argv.slice(2));
  const durumYolu = path.join(PUBLIC, 'durum.json');
  let durum = {};
  try { durum = JSON.parse(await readFile(durumYolu, 'utf8')).betikler || {}; } catch { /* ilk çalıştırma */ }

  // Kaldırılmış betiklerin (ör. eski "haberler") kayıtlarını at.
  for (const ad of Object.keys(durum)) if (!BETIKLER.includes(ad)) delete durum[ad];

  // Hiçbir betiğe ait olmayan eski JSON'lar yayından kalksın (önbellek dosyaları betik adıyla başlar).
  try {
    for (const f of await readdir(PUBLIC)) {
      if (!f.endsWith('.json') || f === 'durum.json') continue;
      const ad = f.slice(0, -5);
      if (!BETIKLER.some((b) => ad === b || ad.startsWith(`${b}-`))) await unlink(path.join(PUBLIC, f));
    }
  } catch { /* klasör yoksa */ }

  let basarili = 0;
  for (const [i, ad] of liste.entries()) {
    if (i) await bekle(1000);
    const bas = Date.now();
    const kayit = durum[ad] || {};
    try {
      const mod = await import(`./scripts/${ad}.mjs`);
      const sonuc = await mod.main();
      kayit.sonBasari = new Date().toISOString();
      kayit.ogeSayisi = sonuc?.ogeler?.length ?? null;
      kayit.plan = sonuc?.plan ?? null;
      kayit.kaynak = sonuc?.kaynak ?? null;
      kayit.sonHata = null;
      basarili++;
    } catch (e) {
      kayit.sonHata = { zaman: new Date().toISOString(), mesaj: String(e?.message || e).slice(0, 300) };
      console.error(`✖ ${ad}: ${kayit.sonHata.mesaj}`);
    }
    kayit.sureMs = Date.now() - bas;
    durum[ad] = kayit;
  }

  await mkdir(PUBLIC, { recursive: true });
  await writeFile(durumYolu, JSON.stringify({ guncelleme: new Date().toISOString(), betikler: durum }, null, 1), 'utf8');
  console.log(`\n${basarili}/${liste.length} betik başarılı.`);
  if (basarili === 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
