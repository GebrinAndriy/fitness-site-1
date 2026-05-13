import Anthropic from '@anthropic-ai/sdk';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import fetch from 'node-fetch';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default async function handler(req, res) {
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

  // 1. ВІДПОВІДАЄМО STRIPE НЕГАЙНО (щоб не було таймауту 10с)
  res.status(200).json({ ok: true, status: 'Processing' });

  // 2. ФОНОВА ОБРОБКА (весь ваш оригінальний код тут)
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
      const age = Array.isArray(quizData) ? (quizData[1] || '25-35') : (quizData.age || '25-35');
      const goal = Array.isArray(quizData) ? (quizData[2] || 'Weight Loss') : (quizData.goal || 'Weight Loss');
      const bodyType = Array.isArray(quizData) ? (quizData[3] || 'Average') : (quizData.bodyType || 'Average');
      const weight = Array.isArray(quizData) ? (quizData[5] || '70kg') : (quizData.weight || '70kg');
      const height = Array.isArray(quizData) ? (quizData[6] || '170cm') : (quizData.height || '170cm');

      // --- ГЕНЕРАЦІЯ CLAUDE ---
      const client = new Anthropic({ apiKey });
      const prompt = `Erstelle einen PERSONALISIERTEN 30-TAGE-FITNESSPLAN für: Geschlecht ${gender}, Alter ${age}, Ziel: ${goal}, Körpertyp: ${bodyType}, Gewicht: ${weight}, Größe: ${height}.
      Antworte NUR mit validem JSON:
      {
        "summary": "2-3 Sätze Motivation",
        "schedule": [
          {"days": "TAGE 1-2", "workout": "Spezifische Übungen", "diet": "Ernährungstipps"},
          ... точно 15 блоків
        ],
        "tips": ["Tipp 1", "Tipp 2", "Tipp 3", "Tipp 4"]
      }
      WICHTIG: ALLES AUF DEUTSCH.`;

      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001', // залишаю вашу модель
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      });

      const planText = message.content[0].text.trim();
      let planData;
      try {
        const jsonStr = planText.substring(planText.indexOf('{'), planText.lastIndexOf('}') + 1);
        planData = JSON.parse(jsonStr);
      } catch (e) { return; }

      // --- ГЕНЕРАЦІЯ PDF (оригінальна верстка) ---
      const doc = new PDFDocument({ margin: 0, size: [842, 595] });
      try {
        doc.registerFont('Arial', join(process.cwd(), 'arial.ttf'));
        doc.registerFont('Arial-Bold', join(process.cwd(), 'arialbd.ttf'));
        doc.font('Arial');
      } catch (e) { doc.font('Helvetica'); }

      let buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      const pdfPromise = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(buffers))));

      async function fetchImage(url) {
        try {
          const response = await fetch(url);
          return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
        } catch (e) { return null; }
      }

      const imageUrls = [
        'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=70',
        'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=800&q=70',
        'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&q=70',
        'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&q=70',
        'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=70',
        'https://images.unsplash.com/photo-1447452001602-7090c7ab2db3?w=800&q=70'
      ];
      const images = await Promise.all(imageUrls.map(url => fetchImage(url)));

      // SLIDE 1: COVER
      if (images[0]) doc.image(images[0], 0, 0, { width: 842, height: 595 });
      doc.rect(0, 0, 842, 595).fillColor('#000000').fillOpacity(0.4).fill();
      doc.fillOpacity(1).fillColor('#FFFFFF');
      doc.fontSize(48).font('Arial-Bold').text('30-TAGE-TRANSFORMATION', 0, 200, { align: 'center' });
      doc.fontSize(22).font('Arial').text('DEIN PERSONALISIERTER ERNÄHRUNGS- & FITNESSPLAN', { align: 'center' });
      doc.fontSize(26).font('Arial-Bold').text(`ERSTELLT FÜR ${customerName.toUpperCase()}`, 0, 320, { align: 'center' });

      // SLIDE 2: SUMMARY
      doc.addPage();
      if (images[1]) doc.image(images[1], 0, 0, { width: 842, height: 595 });
      doc.rect(40, 40, 400, 515).fillColor('#FFFFFF').fillOpacity(0.9).fill();
      doc.fillOpacity(1).fillColor('#1A1A2E');
      doc.fontSize(32).font('Arial-Bold').text('DIE STRATEGIE', 70, 80);
      doc.rect(70, 120, 50, 4).fill('#E8454A');
      doc.fontSize(18).font('Arial').text(planData.summary, 70, 160, { width: 340, lineGap: 8 });

      // SLIDES: 30 DAYS
      for (let i = 0; i < planData.schedule.length; i++) {
        const item = planData.schedule[i];
        doc.addPage();
        const bgIdx = (i % 2 === 0) ? 2 : 3;
        if (images[bgIdx]) doc.image(images[bgIdx], 0, 0, { width: 842, height: 595 });
        doc.rect(40, 40, 762, 515).fillColor('#FFFFFF').fillOpacity(0.95).fill();
        doc.fillOpacity(1).fillColor('#E8454A').fontSize(36).font('Arial-Bold').text(item.days, 80, 70);
        doc.fillColor('#1A1A2E').fontSize(20).font('Arial-Bold').text('ERNÄHRUNGSPLAN', 80, 140);
        doc.fontSize(16).font('Arial').text(item.diet, 80, 175, { width: 330, lineGap: 5 });
        doc.fillColor('#10B981').fontSize(20).font('Arial-Bold').text('WORKOUT', 440, 140);
        doc.fillColor('#1A1A2E').fontSize(16).font('Arial').text(item.workout, 440, 175, { width: 330, lineGap: 5 });
      }

      // FINAL SLIDE: TIPS
      doc.addPage();
      if (images[5]) doc.image(images[5], 0, 0, { width: 842, height: 595 });
      doc.rect(100, 80, 642, 435).fillColor('#FFFFFF').fillOpacity(0.9).fill();
      doc.fillOpacity(1).fillColor('#E8454A').fontSize(32).font('Arial-Bold').text('PROFI-TIPPS FÜR DEN ERFOLG', 140, 120);
      doc.y = 170;
      doc.fillColor('#1A1A2E').fontSize(14).font('Arial');
      planData.tips.forEach(tip => {
        doc.circle(150, doc.y + 7, 4).fill('#E8454A');
        doc.text(tip, 170, doc.y, { width: 500, lineGap: 4 });
        doc.moveDown(0.8);
      });

      doc.end();
      const pdfBuffer = await pdfPromise;

      // --- ВІДПРАВКА ПОШТИ ---
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      });

      await transporter.sendMail({
        from: `"BildBody Fitness" <${process.env.EMAIL_USER}>`,
        to: customerEmail,
        subject: `🔥 Dein persönlicher 30-Tage-Plan ist fertig, ${customerName}!`,
        html: `<h1>Hallo ${customerName}!</h1><p>Dein Plan ist im Anhang.</p>`,
        attachments: [
          { filename: `Plan_${customerName}.pdf`, content: pdfBuffer },
          { filename: 'Diet_Plan.pdf', path: join(process.cwd(), 'diet.pdf') }
        ]
      });

    } catch (err) {
      console.error('Background error:', err);
    }
  })();
}
