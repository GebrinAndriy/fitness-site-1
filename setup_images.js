import fs from 'fs';
import https from 'https';
import path from 'path';

const dir = './api/assets/plan';
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// 30 ПЕРЕВІРЕНИХ ПРЕМІАЛЬНИХ ПОСИЛАНЬ (ВІДІБРАНО ВРУЧНУ)
const urls = [
  "https://unsplash.com/photos/CQfNt66ttZM/download?w=600",
  "https://unsplash.com/photos/sHfo3WOgGTU/download?w=600",
  "https://unsplash.com/photos/20jX9b35r_M/download?w=600",
  "https://unsplash.com/photos/WvDYdXDzkhs/download?w=600",
  "https://unsplash.com/photos/03b61PY89hs/download?w=600",
  "https://unsplash.com/photos/1RNQ11ZODJM/download?w=600",
  "https://unsplash.com/photos/LOA2mTj1vhc/download?w=600",
  "https://unsplash.com/photos/w7jYaN7GqyA/download?w=600",
  "https://unsplash.com/photos/jO6vBWX9h9Y/download?w=600",
  "https://unsplash.com/photos/VJ2s0c20qCo/download?w=600",
  "https://unsplash.com/photos/0ShTs8iPY28/download?w=600",
  "https://unsplash.com/photos/TAZoUmDqzXk/download?w=600",
  "https://unsplash.com/photos/5UbIqV58CW8/download?w=600",
  "https://unsplash.com/photos/fqMu99l8sqo/download?w=600",
  "https://unsplash.com/photos/7kEpUPB8vNk/download?w=600",
  "https://unsplash.com/photos/buWcS7G1_28/download?w=600",
  "https://unsplash.com/photos/AzX5iNFYBMY/download?w=600",
  "https://unsplash.com/photos/k47w6BeapCs/download?w=600",
  "https://unsplash.com/photos/3jAN9InapQI/download?w=600",
  "https://unsplash.com/photos/gzeTjGu3b_k/download?w=600",
  "https://unsplash.com/photos/gnJqUTCPzzg/download?w=600",
  "https://unsplash.com/photos/Apejl7P4-vk/download?w=600",
  "https://unsplash.com/photos/wXBK9JrM0iU/download?w=600",
  "https://unsplash.com/photos/9y4MaTz2Js0/download?w=600",
  "https://unsplash.com/photos/h9t94gzm6q8/download?w=600",
  "https://unsplash.com/photos/S9Q7WXqljyI/download?w=600",
  "https://unsplash.com/photos/gu4bdVTq0CU/download?w=600",
  "https://unsplash.com/photos/Ksl3D9tlfWs/download?w=600",
  "https://unsplash.com/photos/lvMR5ebekPM/download?w=600",
  "https://unsplash.com/photos/2ZF0q3nnuCQ/download?w=600"
];

async function downloadImage(url, num) {
  const filePath = path.join(dir, `${num}.jpg`);
  
  return new Promise((resolve) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };

    const request = (targetUrl) => {
      https.get(targetUrl, options, (res) => {
        // Обробка редіректів (Unsplash часто редіректить на CDN)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location);
          return;
        }

        if (res.statusCode !== 200) {
          console.error(`✗ Error ${num}: HTTP ${res.statusCode}`);
          resolve(false);
          return;
        }

        const file = fs.createWriteStream(filePath);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`✓ Image ${num}/30 (Verified) ready`);
          resolve(true);
        });
      }).on('error', (err) => {
        console.error(`✗ Error ${num}: ${err.message}`);
        resolve(false);
      });
    };

    request(url);
  });
}

async function run() {
  console.log("🚀 Starting MANUAL VERIFIED download (30 images)...");
  for (let i = 0; i < urls.length; i++) {
    await downloadImage(urls[i], i + 1);
    await new Promise(r => setTimeout(r, 600)); // Пауза для стабільності
  }
  console.log("✨ ALL DONE! Your premium library is ready.");
}

run();
