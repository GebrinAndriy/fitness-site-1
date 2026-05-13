import Anthropic from '@anthropic-ai/sdk';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const event = req.body;
    const isTest = req.headers['x-test-mode'] === 'true';

    if (!isTest && event.type !== 'checkout.session.completed') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const session = event.data?.object || event.data;
    const customerEmail = session.customer_details?.email || session.customer_email || session.user_email || session.email;
    const customerName = session.customer_details?.name || session.user_name || 'there';

    // 1. ВІДПОВІДАЄМО STRIPE НЕГАЙНО
    res.status(200).json({ ok: true, status: 'Processing' });

    // 2. ФОНОВА ОБРОБКА
    (async () => {
      try {
        let quizData = {};
        const clientRef = session.client_reference_id || session.custom_data?.data;
        if (clientRef) {
          try {
            const decodedRef = decodeURIComponent(clientRef);
            quizData = JSON.parse(decodedRef);
          } catch (e) {
            try { quizData = JSON.parse(clientRef); } catch (e2) { quizData = clientRef; }
          }
        }

        const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
        if (!apiKey || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;

        const gender = Array.isArray(quizData) ? (quizData[0] || 'person') : (quizData.gender || 'person');
        const goal = Array.isArray(quizData) ? (quizData[2] || 'Weight Loss') : (quizData.goal || 'Weight Loss');

        // --- ГЕНЕРАЦІЯ CLAUDE (30 окремих днів) ---
        const client = new Anthropic({ apiKey });
        const prompt = `Erstelle einen detaillierten 30-TAGE-ERNÄHRUNGSPLAN für: Geschlecht ${gender}, Ziel: ${goal}.
        Antworte NUR mit validem JSON:
        {
          "summary": "3 Sätze Motivation",
          "days": [
            {"day": 1, "diet": "Frühstück, Mittag, Abendessen", "workout": "Tagesziel"},
            ... genau 30 Tage
          ],
          "tips": ["Tipp 1", "Tipp 2", "Tipp 3", "Tipp 4"]
        }
        Sprache: Deutsch.`;

        const message = await client.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }],
        });

        const planData = JSON.parse(message.content[0].text.trim());

        // --- ГЕНЕРАЦІЯ PDF ---
        const doc = new PDFDocument({ margin: 0, size: [842, 595] });
        try {
          doc.registerFont('Arial', join(process.cwd(), 'arial.ttf'));
          doc.registerFont('Arial-Bold', join(process.cwd(), 'arialbd.ttf'));
          doc.font('Arial');
        } catch (e) { doc.font('Helvetica'); }

        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        const pdfPromise = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(buffers))));

        async function fetchImage(keyword) {
          try {
            const url = `https://source.unsplash.com/800x600/?fitness,healthy,food,${keyword}&sig=${Math.random()}`;
            const response = await fetch(url);
            return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
          } catch (e) { return null; }
        }

        // Завантажуємо фото для обкладинки та фонів (для швидкості візьмемо 10 унікальних і будемо чергувати)
        const images = await Promise.all([
          fetchImage('cover'), fetchImage('workout'), fetchImage('meal'), 
          fetchImage('body'), fetchImage('gym'), fetchImage('vegetables'),
          fetchImage('run'), fetchImage('yoga'), fetchImage('fruit'), fetchImage('strong')
        ]);

        // SLIDE 1: COVER
        if (images[0]) doc.image(images[0], 0, 0, { width: 842, height: 595 });
        doc.rect(0, 0, 842, 595).fillColor('#000000').fillOpacity(0.5).fill();
        doc.fillOpacity(1).fillColor('#FFFFFF');
        doc.fontSize(50).font('Arial-Bold').text('30-TAGE TRANSFORMATION', 0, 240, { align: 'center' });
        doc.fontSize(24).text(`PERSONALISIERT FÜR ${customerName.toUpperCase()}`, { align: 'center' });

        // 30 ДНІВ - ШАХОВИЙ ПОРЯДОК
        planData.days.forEach((day, idx) => {
          doc.addPage();
          const isLeft = idx % 2 === 0;
          const bgImg = images[(idx % 9) + 1] || images[0];

          if (isLeft) {
            // Фото зліва
            if (bgImg) doc.image(bgImg, 0, 0, { width: 421, height: 595 });
            doc.rect(421, 0, 421, 595).fill('#FFFFFF');
            doc.fillColor('#E8454A').fontSize(40).font('Arial-Bold').text(`TAG ${day.day}`, 461, 60);
            doc.fillColor('#1A1A2E').fontSize(22).text('ERNÄHRUNG', 461, 130);
            doc.fontSize(14).font('Arial').text(day.diet, 461, 170, { width: 340, lineGap: 5 });
            doc.fillColor('#10B981').fontSize(22).font('Arial-Bold').text('WORKOUT', 461, 380);
            doc.fillColor('#1A1A2E').fontSize(14).font('Arial').text(day.workout, 461, 420, { width: 340 });
          } else {
            // Фото справа
            if (bgImg) doc.image(bgImg, 421, 0, { width: 421, height: 595 });
            doc.rect(0, 0, 421, 595).fill('#FFFFFF');
            doc.fillColor('#E8454A').fontSize(40).font('Arial-Bold').text(`TAG ${day.day}`, 40, 60);
            doc.fillColor('#1A1A2E').fontSize(22).text('ERNÄHRUNG', 40, 130);
            doc.fontSize(14).font('Arial').text(day.diet, 40, 170, { width: 340, lineGap: 5 });
            doc.fillColor('#10B981').fontSize(22).font('Arial-Bold').text('WORKOUT', 40, 380);
            doc.fillColor('#1A1A2E').fontSize(14).font('Arial').text(day.workout, 40, 420, { width: 340 });
          }
        });

        doc.end();
        const pdfBuffer = await pdfPromise;

        // ВІДПРАВКА
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        });

        await transporter.sendMail({
          from: `"BildBody" <${process.env.EMAIL_USER}>`,
          to: customerEmail,
          subject: `✅ Fertig! Dein 30-Tage Plan ist da, ${customerName}`,
          html: `<h3>Hallo ${customerName}!</h3><p>Anbei findest du deine persönliche Transformation für die nächsten 30 Tage.</p>`,
          attachments: [
            { filename: `Plan_Tag_1-30_${customerName}.pdf`, content: pdfBuffer },
            { filename: 'BildBody_Premium_Guide.pdf', path: join(process.cwd(), 'diet.pdf') }
          ]
        });
      } catch (err) { console.error('BG Error:', err); }
    })();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
