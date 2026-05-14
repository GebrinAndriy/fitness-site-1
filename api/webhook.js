import Anthropic from '@anthropic-ai/sdk';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const event = req.body;
    const session = event.data?.object || event.data;
    const customerEmail = session.customer_details?.email || session.customer_email || 'lakerboss228@gmail.com';
    const customerName = session.customer_details?.name || 'Customer';

    const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
    const client = new Anthropic({ apiKey });

    // 1. ГЕНЕРАЦІЯ ТЕКСТУ (Швидко, тільки тренування)
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: `Erstelle einen 7-Tage-Trainingsplan für ${customerName}. NUR TRAINING. Pro Tag 6 Übungen mit Sätzen und Wiederholungen (z.B. Bankdrücken 3x12). Deutsch. JSON: {"days": [{"day": 1, "workout": "Übung 1 (3x12)\nÜbung 2 (3x10)...", "focus": "Muskelgruppe"}]}.` }],
    });

    const weekData = JSON.parse(message.content[0].text.trim().substring(message.content[0].text.indexOf('{'), message.content[0].text.lastIndexOf('}') + 1));

    const doc = new PDFDocument({ margin: 0, size: [842, 595] });
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    const pdfPromise = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(buffers))));

    doc.font('Helvetica');

    // ФУНКЦІЯ ДЛЯ ЗЧИТУВАННЯ ЛОКАЛЬНОГО ФОТО
    const getLocalImg = (num) => {
      try {
        const path = join(__dirname, 'assets', 'plan', `${num}.jpg`);
        return fs.existsSync(path) ? fs.readFileSync(path) : null;
      } catch (e) { return null; }
    };

    // --- COVER ---
    const coverImg = getLocalImg(1);
    if (coverImg) doc.image(coverImg, 0, 0, { width: 842, height: 595 });
    doc.rect(0, 0, 842, 595).fillColor('#000000').fillOpacity(0.4).fill();
    doc.fillOpacity(1).fillColor('#E8454A').fontSize(24).font('Helvetica-Bold').text('BILDBODY', 80, 50);
    doc.fillColor('#FFFFFF').fontSize(60).text('30 TAGE', 80, 360);
    doc.fontSize(28).font('Helvetica').text('TRAINING STRATEGIE', 80, 420);
    doc.fontSize(16).font('Helvetica-Bold').text(`EXKLUSIV FÜR ${customerName.toUpperCase()}`, 80, 510);

    // --- 30 DAYS (Кожен день — нове унікальне фото!) ---
    for (let i = 1; i <= 30; i++) {
      const dayData = weekData.days[(i - 1) % 7];
      doc.addPage();
      const isLeft = i % 2 === 0;
      
      const img = getLocalImg(i); // Беремо фото по номеру дня (1..30)

      if (img) {
        // Використовуємо 'cover', щоб фото повністю заповнювало область без білих смуг
        doc.image(img, isLeft ? 0 : 421, 0, { cover: [421, 595] });
      }

      doc.rect(isLeft ? 421 : 0, 0, 421, 595).fill('#FFFFFF');
      doc.rect(isLeft ? 421 : 0, 0, 8, 595).fill('#E8454A');

      const x = isLeft ? 461 : 40;
      doc.fillColor('#E8454A').fontSize(110).font('Helvetica-Bold').fillOpacity(0.06).text(`${i}`, x, 40);
      doc.fillOpacity(1).fontSize(42).text(`TAG ${i}`, x, 85);
      doc.fillColor('#1A1A2E').fontSize(18).font('Helvetica-Bold').text('FOKUS', x, 165);
      doc.fontSize(14).font('Helvetica').text(dayData.focus, x, 195, { width: 340 });
      doc.fillColor('#10B981').fontSize(18).font('Helvetica-Bold').text('TRAININGSPLAN', x, 270);
      doc.fillColor('#1A1A2E').fontSize(13).font('Helvetica').text(dayData.workout, x, 310, { width: 340, lineGap: 8 });
    }

    // --- FINAL ---
    doc.addPage().rect(0, 0, 842, 595).fill('#1A1A2E');
    doc.fillColor('#E8454A').fontSize(80).font('Helvetica-Bold').text('DANKE!', 0, 180, { align: 'center' });
    doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica').text('Deine Transformation hat gerade erst begonnen.', 0, 280, { align: 'center' });
    doc.fontSize(18).text('Bleib fokussiert, bleib stark und glaube an den Prozess.', 0, 320, { align: 'center' });
    doc.fontSize(24).font('Helvetica-Bold').text('BILDBODY', 0, 500, { align: 'center' });

    doc.end();
    const pdfBuffer = await pdfPromise;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    await transporter.sendMail({
      from: `"BildBody" <${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: `✅ Dein Trainingsplan ist fertig, ${customerName}`,
      html: `
        <div style="font-family: Arial; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
          <div style="background: #E8454A; padding: 40px; text-align: center;"><h1 style="color: white; margin: 0; letter-spacing: 2px;">BILDBODY</h1></div>
          <div style="padding: 40px; color: #333;">
            <h2>Hallo ${customerName}! 👋</h2>
            <p>Dein Trainingsplan ist bereit.</p>
            <div style="background: #f0fdf4; border-left: 4px solid #10B981; padding: 20px; margin: 20px 0;">✅ <strong>PDF-Plan im Anhang</strong></div>
          </div>
        </div>`,
      attachments: [
        { filename: `Plan_${customerName}.pdf`, content: pdfBuffer },
        { filename: 'Premium_Guide.pdf', path: join(process.cwd(), 'BildBodyDietPlan.pdf') }
      ]
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
