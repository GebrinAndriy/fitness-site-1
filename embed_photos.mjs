import { PDFDocument } from 'pdf-lib';
import fs from 'fs';
import fetch from 'node-fetch';

// Використовуємо 30 надійних прямих посилань на CDN Unsplash (це UUID фотографій їжі).
// Прямі посилання не викликають помилок 403 і працюють блискавично.
// Ми їх зациклимо на 90 страв (кожна фотка повториться лише 3 рази за весь місяць, що виглядає природньо).
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

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log("Відкриваю оригінальний файл BildBody_Diet.pdf...");
  const existingPdfBytes = fs.readFileSync('BildBody_Diet.pdf');
  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  
  // Кеш картинок для прискорення (щоб не качати одне й те саме)
  const imgCache = {};

  async function getPdfImage(index) {
      const id = ids[index % ids.length];
      // Використовуємо ПРЯМИЙ CDN лінк. Це обходить 403 помилку і одразу дає JPG
      const url = `https://images.unsplash.com/photo-${id}?w=400&fm=jpg&q=80`;
      
      if (imgCache[url]) return imgCache[url];
      
      console.log(`Завантажую фото ${index + 1}/90...`);
      try {
          const res = await fetch(url);
          if (!res.ok) {
              console.error(`Помилка завантаження: ${res.status}`);
              return null;
          }
          const imgBytes = await res.arrayBuffer();
          const image = await pdfDoc.embedJpg(imgBytes);
          imgCache[url] = image;
          return image;
      } catch (err) {
          console.error(`Помилка:`, err.message);
          return null;
      }
  }

  // Дні розташовані на сторінках з 4 по 18 (індекси 3..17)
  const startPageIdx = 3;
  const endPageIdx = 17;

  let globalMealCounter = 0;

  for (let i = startPageIdx; i <= endPageIdx; i++) {
    const page = pdfDoc.getPages()[i];
    const { width, height } = page.getSize();
    
    console.log(`Вставляю фотографії на сторінку ${i + 1}...`);

    // Я зрозумів свою помилку: у вас макет це 2 колонки (Ліва - День 1, Права - День 2).
    // А сніданок, обід і вечеря йдуть ЗВЕРХУ ВНИЗ у кожній колонці.
    
    // Координати X для колонок (трохи лівіше, як ви просили)
    const col1X = 65; // Ліва колонка (День N)
    const col2X = width / 2 + 55; // Права колонка (День N+1)

    // Максимальні розміри для фото (scaleToFit не дасть їм розтягнутись негарно)
    const maxImgWidth = 140;
    const maxImgHeight = 85;

    // Y координати для страв (рахуються знизу сторінки у pdf-lib)
    // Якщо висота сторінки 595 (Landscape):
    // Сніданок під текстом
    const yBreakfast = height - 210 - maxImgHeight; // ~300
    // Обід під текстом
    const yLunch = height - 350 - maxImgHeight;     // ~160
    // Вечеря під текстом
    const yDinner = height - 490 - maxImgHeight;    // ~20
    
    const mealYs = [yBreakfast, yLunch, yDinner];

    // --- День N (Ліва колонка) ---
    for (let meal = 0; meal < 3; meal++) {
        const image = await getPdfImage(globalMealCounter);
        if (image) {
            // scaleToFit зберігає пропорції! Фото не буде розтягнутим чи сплюснутим.
            const dims = image.scaleToFit(maxImgWidth, maxImgHeight);
            page.drawImage(image, { x: col1X, y: mealYs[meal], width: dims.width, height: dims.height });
        }
        globalMealCounter++;
        await delay(200); // Невелика затримка, щоб не перевантажувати мережу
    }

    // --- День N+1 (Права колонка) ---
    for (let meal = 0; meal < 3; meal++) {
        const image = await getPdfImage(globalMealCounter);
        if (image) {
            const dims = image.scaleToFit(maxImgWidth, maxImgHeight);
            page.drawImage(image, { x: col2X, y: mealYs[meal], width: dims.width, height: dims.height });
        }
        globalMealCounter++;
        await delay(200);
    }
  }

  console.log("Зберігаю новий файл...");
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync('BildBody_Diet_Mit_Fotos.pdf', pdfBytes);
  console.log("✨ ГОТОВО! Файл BildBody_Diet_Mit_Fotos.pdf успішно створено.");
}

run().catch(console.error);
