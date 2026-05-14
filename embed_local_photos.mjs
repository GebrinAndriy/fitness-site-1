import { PDFDocument } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

const dir = './diet_photos';

async function run() {
  console.log("Відкриваю оригінальний файл BildBody_Diet.pdf...");
  const existingPdfBytes = fs.readFileSync('BildBody_Diet.pdf');
  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  
  const startPageIdx = 3; // Сторінки з 4 по 18
  const endPageIdx = 17;

  let globalMealCounter = 1;

  for (let i = startPageIdx; i <= endPageIdx; i++) {
    const page = pdfDoc.getPages()[i];
    const { width, height } = page.getSize();
    
    console.log(`Вставляю фотографії на сторінку ${i + 1}...`);
    
    // Координати для 2 колонок
    const col1X = 65; // Ліва колонка (День N)
    const col2X = width / 2 + 55; // Права колонка (День N+1)

    // Максимальні розміри для фото
    const maxImgWidth = 140;
    const maxImgHeight = 85;

    // Y координати (зверху вниз: сніданок, обід, вечеря)
    const yBreakfast = height - 210 - maxImgHeight;
    const yLunch = height - 350 - maxImgHeight;
    const yDinner = height - 490 - maxImgHeight;
    
    const mealYs = [yBreakfast, yLunch, yDinner];

    // --- День N (Ліва колонка) ---
    for (let meal = 0; meal < 3; meal++) {
        const filePath = path.join(dir, `${globalMealCounter}.jpg`);
        if (fs.existsSync(filePath)) {
            const imgBytes = fs.readFileSync(filePath);
            const image = await pdfDoc.embedJpg(imgBytes);
            const dims = image.scaleToFit(maxImgWidth, maxImgHeight);
            page.drawImage(image, { x: col1X, y: mealYs[meal], width: dims.width, height: dims.height });
        } else {
            console.log(`Файл ${globalMealCounter}.jpg не знайдено, пропускаю...`);
        }
        globalMealCounter++;
    }

    // --- День N+1 (Права колонка) ---
    for (let meal = 0; meal < 3; meal++) {
        const filePath = path.join(dir, `${globalMealCounter}.jpg`);
        if (fs.existsSync(filePath)) {
            const imgBytes = fs.readFileSync(filePath);
            const image = await pdfDoc.embedJpg(imgBytes);
            const dims = image.scaleToFit(maxImgWidth, maxImgHeight);
            page.drawImage(image, { x: col2X, y: mealYs[meal], width: dims.width, height: dims.height });
        }
        globalMealCounter++;
    }
  }

  console.log("Зберігаю новий файл...");
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync('BildBody_Diet_Mit_Fotos.pdf', pdfBytes);
  console.log("✨ ГОТОВО! Файл BildBody_Diet_Mit_Fotos.pdf успішно створено. Усі ваші локальні фото вставлено!");
}

run().catch(console.error);
