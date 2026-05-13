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
    const session = event.data?.object || event.data;
    const customerEmail = session.customer_details?.email || session.customer_email || 'lakerboss228@gmail.com';
    const customerName = session.customer_details?.name || 'Customer';

    const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
    if (!apiKey) return res.status(500).json({ error: "No API Key" });

    const client = new Anthropic({ apiKey });
    
    // 1. НАДШВИДКИЙ ЗАПИТ (Тільки 7 днів)
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: `Erstelle einen perfekten 7-Tage-Fitness-Zyklus für ${customerName}. JSON: {"summary": "...", "days": [{"day": 1, "diet": "...", "workout": "..."}]}. Deutsch.` }],
    });

    const weekData = JSON.parse(message.content[0].text.trim().substring(message.content[0].text.indexOf('{'), message.content[0].text.lastIndexOf('}') + 1));

    // 2. ГЕНЕРАЦІЯ 30 СТОРІНОК (Циклічно з 7 днів)
    const doc = new PDFDocument({ margin: 0, size: [842, 595] });
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    const pdfPromise = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(buffers))));

    doc.font('Helvetica');

    // Cover
    doc.rect(0, 0, 842, 595).fill('#1A1A2E');
    doc.fillColor('#E8454A').rect(0, 200, 842, 100).fill();
    doc.fillColor('#FFFFFF').fontSize(60).text('30 TAGE PLAN', 0, 225, { align: 'center' });

    // Розмножуємо 7 днів на 30 сторінок
    for (let i = 1; i <= 30; i++) {
      const dayData = weekData.days[(i - 1) % 7];
      doc.addPage();
      const isLeft = i % 2 === 0;
      doc.rect(isLeft ? 0 : 421, 0, 421, 595).fill('#F8F9FA');
      doc.rect(isLeft ? 421 : 0, 0, 10, 595).fill('#E8454A');
      const x = isLeft ? 461 : 50;
      doc.fillColor('#E8454A').fontSize(120).fillOpacity(0.05).text(`${i}`, x, 50);
      doc.fillOpacity(1).fontSize(38).text(`TAG ${i}`, x, 90);
      doc.fillColor('#1A1A2E').fontSize(16).text('ERNÄHRUNG', x, 160);
      doc.fontSize(12).text(dayData.diet, x, 195, { width: 330 });
      doc.fillColor('#10B981').fontSize(16).text('WORKOUT', x, 380);
      doc.fillColor('#1A1A2E').fontSize(12).text(dayData.workout, x, 410, { width: 330 });
    }

    doc.end();
    const pdfBuffer = await pdfPromise;

    // 3. ВІДПРАВКА (Ваш брендований лист)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    await transporter.sendMail({
      from: `"BildBody" <${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: `✅ Dein Plan ist fertig, ${customerName}`,
      html: `
        <div style="font-family: Arial; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
          <div style="background: #E8454A; padding: 40px; text-align: center;"><h1 style="color: white; margin: 0; letter-spacing: 2px;">BILDBODY</h1></div>
          <div style="padding: 40px; color: #333;">
            <h2>Hallo ${customerName}! 👋</h2>
            <p>Dein individueller 30-Tage Plan ist im Anhang.</p>
            <div style="background: #f0fdf4; border-left: 4px solid #10B981; padding: 20px; margin: 20px 0;">✅ Dein PDF-Plan ist im Anhang!</div>
          </div>
        </div>`,
      attachments: [
        { filename: `Plan_${customerName}.pdf`, content: pdfBuffer },
        { filename: 'Premium_Guide.pdf', path: join(process.cwd(), 'diet.pdf') }
      ]
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
