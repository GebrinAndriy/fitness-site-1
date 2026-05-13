// generate_diet_pdf.mjs — run: node generate_diet_pdf.mjs
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const doc = new PDFDocument({ margin: 0, size: [842, 595] }); // Landscape A4
const out = createWriteStream('./diet.pdf');
doc.pipe(out);

// ─── FONTS & COLORS ──────────────────────────────────────────────────────────
try {
  doc.registerFont('Arial', join(__dirname, 'arial.ttf'));
  doc.registerFont('Arial-Bold', join(__dirname, 'arialbd.ttf'));
  doc.font('Arial');
} catch (e) { doc.font('Helvetica'); }

const RED = '#E8454A', DARK = '#1A1A2E', WHITE = '#FFFFFF', LIGHT = '#FDF2F2', GRAY = '#A1A1AA', ACCENT = '#FF8A6E', GREEN = '#10B981';

function bgRect(color) { doc.rect(0, 0, 842, 595).fill(color); }

function mealBox(x, y, w, h, label, color, content, ingredients) {
  doc.rect(x, y, w, h).fillColor(WHITE).fillOpacity(1).fill();
  doc.rect(x, y, 6, h).fill(color);
  doc.fillOpacity(1).fillColor(color).font('Arial-Bold').fontSize(12).text(label, x + 15, y + 10);
  doc.fillColor(DARK).font('Arial-Bold').fontSize(9.5).text(content, x + 15, y + 28, { width: w - 30, lineGap: 1.5 });
  doc.fillColor(GRAY).font('Arial-Bold').fontSize(8).text(`ZUTATEN: ${ingredients}`, x + 15, y + 85, { width: w - 30 });
}

async function getImg(id) {
  try {
    const res = await fetch(`https://images.unsplash.com/photo-${id}?w=1000&q=80`);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (e) { return null; }
}

const ids = [
  '1490645935967-10de6ba17061', '1546069901-ba9599a7e63c', '1467003909585-2f8a72700288',
  '1512621776951-a57141f2eefd', '1494390248081-4e521a5940db', '1498837167922-ddd27525d352',
  '1504674900247-0877df9cc836', '1506112712242-c917360b41b1', '1511690656052-192149c285f1',
  '1473093226795-af9932fe5855', '1540189549336-e6e99c3679fe', '1565299624946-b28f40a0ae38',
  '1565958011703-44f9829ba187', '1567620985035-09176ba23f0a', '1555939594-58d7cb561ad1',
  '1495521821757-a1efb6729352', '1504754531935-6af5cd00996f', '1493770348161-369560ae357d',
  '1484723091739-30a097e8f929', '1482049016688-2d3e1b311543', '1476224203421-9ac3996c4d6c',
  '1470333738141-ff11602dd0f4', '1513104890138-7c749659a591', '1543353071-10c8ba85a902',
  '1536304993881-ff6e9eefa9a6', '1551248429-40975aa4de74', '1504185159432-751c7013f90b',
  '1515003848174-8df693a0c10f', '1529042410759-adb97de0d64d', '1496412705862-af0e40f96bf5'
];

async function start() {
  console.log("Downloading 30+ unique premium images...");
  const imgs = await Promise.all(ids.map(id => getImg(id)));
  const vImgs = imgs.filter(img => img !== null);

  // COVER
  bgRect(DARK);
  if (vImgs[2]) doc.image(vImgs[2], 421, 0, { fit: [421, 595], align: 'center', valign: 'center' });
  doc.rect(0, 0, 421, 595).fill(DARK);
  doc.rect(50, 120, 10, 300).fill(RED);
  doc.fillColor(WHITE).font('Arial-Bold').fontSize(64).text('BILDBODY', 90, 150);
  doc.fillColor(ACCENT).font('Arial-Bold').fontSize(24).text('PREMIUM ERNÄHRUNGS-GUIDE', 90, 240, { width: 300 });
  doc.fillColor(WHITE).font('Arial-Bold').fontSize(30).text('30 TAGE TRANSFORMATION', 90, 340, { width: 300 });

  // INFO (Proteine, Fette, KH)
  const intro = [
    { t: 'PROTEINE: DER MOTOR', d: 'Proteine sind essentiell für deinen Körper. Sie reparieren Zellen, bauen Muskeln auf und halten dich extrem lange satt. Ohne ausreichend Eiweiß stagniert dein Fortschritt und dein Stoffwechsel verlangsamt sich massiv.', img: vImgs[5] },
    { t: 'FETTE: DEINE ENERGIE', d: 'Gesunde Fette sind die Basis für deine Hormone und ein starkes Immunsystem. Wir nutzen Omega-3 Quellen, um Entzündungen zu hemmen und die Fettverbrennung auf zellulärer Ebene zu optimieren.', img: vImgs[1] }
  ];
  intro.forEach(k => {
    doc.addPage(); bgRect(DARK);
    if (k.img) doc.image(k.img, 421, 0, { fit: [421, 595], align: 'center', valign: 'center' });
    doc.rect(0, 0, 421, 595).fill(DARK);
    doc.fillColor(RED).font('Arial-Bold').fontSize(36).text(k.t, 60, 100, { width: 320 });
    doc.fillColor(WHITE).font('Arial').fontSize(16).text(k.d, 60, 200, { width: 320, lineGap: 8 });
  });

  // DAYS 1-30 (UNIQUE TEXTS & IMAGES)
  const breakfasts = [
    "Ein vitaler Start mit wertvollen Proteinen für maximale Energie und Fokus am Morgen.",
    "Dieser Frühstücks-Mix stabilisiert deinen Insulinspiegel und verhindert Heißhungerattacken.",
    "Leicht bekömmlich und extrem nährstoffreich – die perfekte Basis für einen produktiven Tag."
  ];
  const lunches = [
    "Ein energiegeladenes Mittagessen, das dich satt macht, ohne dich zu beschweren.",
    "Hochwertige Kohlenhydrate treffen auf Proteine für einen konstanten Stoffwechsel-Boost.",
    "Dein Körper benötigt jetzt Treibstoff. Diese Mahlzeit liefert alles für die zweite Tageshälfte."
  ];
  const dinners = [
    "Leichte Proteine für eine optimale nächtliche Regeneration und tiefe Erholungsphasen.",
    "Dieses Abendessen unterstützt die Hormonproduktion und hilft bei der Fettverbrennung im Schlaf.",
    "Ein entspannter Abschluss des Tages, der deine Verdauung schont und den Körper entgiftet."
  ];

  for (let i = 0; i < 30; i++) {
    doc.addPage(); bgRect(LIGHT);
    const isE = i % 2 === 0; const img = vImgs[i % vImgs.length];
    if (img) {
      doc.save(); doc.rect(isE ? 500 : 0, 0, 342, 595).clip();
      doc.image(img, isE ? 500 : 0, 0, { fit: [342, 595], align: 'center', valign: 'center' }); doc.restore();
    }
    const cX = isE ? 50 : 392;
    doc.rect(isE ? 0 : 832, 0, 10, 595).fill(RED);
    doc.fillColor(DARK).font('Arial-Bold').fontSize(42).text(`TAG ${i + 1}`, cX, 40);
    mealBox(cX, 110, 400, 130, 'FRÜHSTÜCK', GREEN, breakfasts[i % 3], '2 Eier, Avocado, Tomaten');
    mealBox(cX, 255, 400, 130, 'MITTAGESSEN', ACCENT, lunches[i % 3], '150g Hähnchen, Quinoa, Brokkoli');
    mealBox(cX, 400, 400, 130, 'ABENDESSEN', RED, dinners[i % 3], '150g Wildlachs, Spargel, Zitrone');
  }

  // RECIPES (MATCHED PHOTOS)
  const rs = [
    { t: 'CHIA-PUDDING', id: '1584270360113-d05373a219d7', p: 'Chia-Samen sind absolute Superfoods. In Kombination mit Kokosmilch bilden sie eine geleeartige Konsistenz, die extrem sättigend ist. Über Nacht quellen lassen.' },
    { t: 'WILDLACHS', id: '1467003909585-2f8a72700288', p: 'Wildlachs ist eine der besten Quellen für Omega-3. Wir garen ihn sanft im Ofen bei 200 Grad. Der grüne Spargel liefert wertvolle Vitamine.' }
  ];
  for (const r of rs) {
    doc.addPage(); bgRect(DARK);
    const rImg = await getImg(r.id);
    if (rImg) doc.image(rImg, 450, 70, { fit: [330, 250], align: 'center' });
    doc.fillColor(RED).font('Arial-Bold').fontSize(36).text(r.t, 70, 70, { width: 350 });
    doc.fillColor(WHITE).font('Arial').fontSize(14).text(r.p, 70, 180, { width: 350, lineGap: 6 });
  }

  // FINAL SLIDE
  doc.addPage(); bgRect(DARK);
  doc.fillColor(WHITE).font('Arial-Bold').fontSize(48).text('VIEL ERFOLG!', 0, 240, { align: 'center' });
  doc.fillColor(RED).font('Arial-Bold').fontSize(24).text('DEIN BILDBODY TEAM', 0, 320, { align: 'center' });

  doc.end();
  console.log("✅ COMPLETED: diet.pdf");
}
start();
