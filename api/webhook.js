import Anthropic from '@anthropic-ai/sdk';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const event = req.body;
    const isTest = req.headers['x-test-mode'] === 'true' || event.id === 'evt_test_webhook';
    
    if (!isTest && event.type !== 'checkout.session.completed') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const session = event.data?.object || event.data;
    const customerEmail = session.customer_details?.email || session.customer_email || session.user_email || session.email;
    const customerName = session.customer_details?.name || session.user_name || 'there';

    // Quiz Data
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
    if (!apiKey || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({ error: "Missing Env Vars" });
    }

    const gender = Array.isArray(quizData) ? (quizData[0] || 'person') : 'person';
    const goal = Array.isArray(quizData) ? (quizData[2] || 'Weight Loss') : 'Weight Loss';

    // --- ПАРАЛЕЛЬНИЙ ЗАПУСК ШІ ТА КАРТИНОК ---
    const client = new Anthropic({ apiKey });
    const prompt = `Erstelle einen 30-TAGE-PLAN für: ${gender}, Ziel: ${goal}. 
    NUR JSON: {"days": [{"day": 1, "diet": "...", "workout": "..."}]}. Sprache: Deutsch.`;

    async function getSafeImage(keyword) {
      try {
        const r = await fetch(`https://source.unsplash.com/400x300/?fitness,${keyword}`);
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      } catch (e) { return null; }
    }

    // Запускаємо все одночасно, щоб вкластися в 10 секунд
    const [message, coverImg, img1, img2] = await Promise.all([
      client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 3500,
        messages: [{ role: 'user', content: prompt }],
      }),
      getSafeImage('workout'),
      getSafeImage('healthy'),
      getSafeImage('gym')
    ]);

    const planData = JSON.parse(message.content[0].text.trim());
    const dayImages = [img1, img2];

    // PDF Generation (Дуже швидка)
    const doc = new PDFDocument({ margin: 0, size: [842, 595] });
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    const pdfPromise = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(buffers))));

    try {
      doc.registerFont('Arial', join(process.cwd(), 'arial.ttf'));
      doc.registerFont('Arial-Bold', join(process.cwd(), 'arialbd.ttf'));
      doc.font('Arial');
    } catch (e) { doc.font('Helvetica'); }

    // Cover
    if (coverImg) doc.image(coverImg, 0, 0, { width: 842, height: 595 });
    doc.rect(0, 0, 842, 595).fillColor('#000000').fillOpacity(0.5).fill();
    doc.fillOpacity(1).fillColor('#FFFFFF').fontSize(50).font('Arial-Bold').text('30-TAGE PLAN', 0, 240, { align: 'center' });

    // Days
    planData.days.forEach((day, idx) => {
      doc.addPage();
      const isLeft = idx % 2 === 0;
      const img = dayImages[idx % 2];
      if (isLeft && img) doc.image(img, 0, 0, { width: 421, height: 595 });
      if (!isLeft && img) doc.image(img, 421, 0, { width: 421, height: 595 });
      
      const textX = isLeft ? 461 : 40;
      doc.fillColor('#E8454A').fontSize(40).font('Arial-Bold').text(`TAG ${day.day}`, textX, 60);
      doc.fillColor('#1A1A2E').fontSize(14).font('Arial').text(day.diet, textX, 150, { width: 340 });
      doc.text(`WORKOUT: ${day.workout}`, textX, 400, { width: 340 });
    });

    doc.end();
    const pdfBuffer = await pdfPromise;

    // Email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    await transporter.sendMail({
      from: `"BildBody" <${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: `✅ Dein Plan ist fertig, ${customerName}`,
      html: `<p>Hallo ${customerName}, hier є твій план!</p>`,
      attachments: [
        { filename: `Plan_${customerName}.pdf`, content: pdfBuffer },
        { filename: 'Premium_Guide.pdf', path: join(process.cwd(), 'diet.pdf') }
      ]
    });

    // ТІЛЬКИ ТЕПЕР ВІДПОВІДАЄМО STRIPE
    return res.status(200).json({ ok: true, sent: true });

  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
