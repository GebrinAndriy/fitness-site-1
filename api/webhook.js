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
    if (!apiKey || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) return res.status(500).json({ error: "Env Error" });

    const client = new Anthropic({ apiKey });

    // --- ПАРАЛЕЛЬНИЙ ЗАПУСК: ШІ + 4 КАРТИНКИ ---
    async function getImg(id) {
      try {
        const r = await fetch(`https://images.unsplash.com/photo-${id}?w=500&q=70`);
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      } catch (e) { return null; }
    }

    const [message, coverImg, img1, img2, img3] = await Promise.all([
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: `7-Tage-Zyklus für ${customerName}. JSON: {"summary": "...", "days": [{"day": 1, "diet": "...", "workout": "..."}]}. Deutsch.` }],
      }),
      getImg('1534438327276-14e5300c3a48'), // Workout Cover
      getImg('1490645935967-10de6ba17061'), // Healthy Food
      getImg('1517836357463-d25dfeac3438'), // Gym
      getImg('1506126613408-eca07ce68773')  // Motivation/Yoga
    ]);

    const weekData = JSON.parse(message.content[0].text.trim().substring(message.content[0].text.indexOf('{'), message.content[0].text.lastIndexOf('}') + 1));
    const dayImages = [img1, img2, img3];

    // --- ГЕНЕРАЦІЯ PDF ---
    const doc = new PDFDocument({ margin: 0, size: [842, 595] });
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    const pdfPromise = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(buffers))));

    doc.font('Helvetica');

    // Cover Page
    if (coverImg) doc.image(coverImg, 0, 0, { width: 842, height: 595 });
    doc.rect(0, 0, 842, 595).fillColor('#000000').fillOpacity(0.5).fill();
    doc.fillOpacity(1).fillColor('#E8454A').rect(0, 250, 842, 80).fill();
    doc.fillColor('#FFFFFF').fontSize(50).font('Helvetica-Bold').text('30 TAGE PLAN', 0, 265, { align: 'center' });

    // 30 Pages
    for (let i = 1; i <= 30; i++) {
      const dayData = weekData.days[(i - 1) % 7];
      doc.addPage();
      const isLeft = i % 2 === 0;
      const currentImg = dayImages[i % 3];

      if (isLeft && currentImg) doc.image(currentImg, 0, 0, { width: 421, height: 595 });
      if (!isLeft && currentImg) doc.image(currentImg, 421, 0, { width: 421, height: 595 });

      doc.rect(isLeft ? 421 : 0, 0, 421, 595).fill('#FFFFFF');
      doc.rect(isLeft ? 421 : 0, 0, 10, 595).fill('#E8454A');

      const x = isLeft ? 461 : 40;
      doc.fillColor('#E8454A').fontSize(100).font('Helvetica-Bold').fillOpacity(0.05).text(`${i}`, x, 50);
      doc.fillOpacity(1).fontSize(38).text(`TAG ${i}`, x, 90);
      
      doc.fillColor('#1A1A2E').fontSize(16).text('ERNÄHRUNG', x, 160);
      doc.fontSize(12).font('Helvetica').text(dayData.diet, x, 190, { width: 330 });
      
      doc.fillColor('#10B981').fontSize(16).font('Helvetica-Bold').text('WORKOUT', x, 380);
      doc.fillColor('#1A1A2E').fontSize(12).font('Helvetica').text(dayData.workout, x, 410, { width: 330 });
    }

    doc.end();
    const pdfBuffer = await pdfPromise;

    // --- ВІДПРАВКА ---
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
