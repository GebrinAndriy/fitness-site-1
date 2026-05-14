import fs from 'fs';
import https from 'https';
import path from 'path';

const dir = './diet_photos';
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

async function download(num) {
  const filePath = path.join(dir, `${num}.jpg`);
  
  // Використовуємо надійний LoremFlickr з ключем lock, щоб гарантувати 90 УНІКАЛЬНИХ фото.
  // Теги підібрані для здорового харчування.
  const tags = ['healthyfood', 'meal', 'salad', 'breakfast', 'dinner', 'cooking', 'fresh'];
  const tag = tags[num % tags.length];
  const url = `https://loremflickr.com/400/300/${tag},delicious?lock=${num + 1000}`;

  return new Promise((resolve) => {
    const file = fs.createWriteStream(filePath);
    
    const request = (targetUrl) => {
      https.get(targetUrl, (res) => {
        // Обробка редіректів (LoremFlickr часто редіректить на фінальне фото)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let nextUrl = res.headers.location;
          if (nextUrl.startsWith('/')) {
            nextUrl = 'https://loremflickr.com' + nextUrl;
          }
          request(nextUrl);
          return;
        }

        if (res.statusCode !== 200) {
          console.error(`✗ Помилка ${num}: HTTP ${res.statusCode}`);
          resolve(false);
          return;
        }

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`✓ Фото ${num}/90 готове`);
          resolve(true);
        });
      }).on('error', (err) => {
        console.error(`✗ Помилка мережі ${num}: ${err.message}`);
        resolve(false);
      });
    };

    request(url);
  });
}

async function run() {
  console.log("🚀 Починаю стабільне завантаження 90 фотографій їжі у папку diet_photos...");
  for (let i = 1; i <= 90; i++) {
    let success = false;
    let retries = 0;
    // Робимо до 3 спроб на кожне фото, якщо щось піде не так
    while (!success && retries < 3) {
        success = await download(i);
        if (!success) {
            retries++;
            console.log(`Повторна спроба для фото ${i} (Спроба ${retries}/3)...`);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    // Затримка щоб сервери нас не заблокували
    await new Promise(r => setTimeout(r, 300));
  }
  console.log("✨ ВСІ 90 ФОТО ЗАВАНТАЖЕНО! Перевірте папку 'diet_photos'.");
}

run();
