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

    // --- ПАРАЛЕЛЬНЕ ЗАВАНТАЖЕННЯ: ШІ + 6 ФОТО ---
    async function getImg(id) {
      try {
        const url = `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1000&q=80`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      } catch (e) { return null; }
    }

    const [message, coverImg, i1, i2, i3, i4, i5] = await Promise.all([
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: `7-Tage-Zyklus für ${customerName}. JSON: {"summary": "...", "days": [{"day": 1, "diet": "...", "workout": "..."}]}. Deutsch.` }],
      }),
      getImg('1534438327276-14e5300c3a48'), // Cover
      getImg('1490645935967-10de6ba17061'), // Food 1
      getImg('1517836357463-d25dfeac3438'), // Gym 1
      getImg('1506126613408-eca07ce68773'), // Stretch
      getImg('1464191306404-516353382441'), // Food 2
      getImg('1534367507873-d2b7e2435942')  // Gym 2
    ]);

    const weekData = JSON.parse(message.content[0].text.trim().substring(message.content[0].text.indexOf('{'), message.content[0].text.lastIndexOf('}') + 1));
    const dayImages = [i1, i2, i3, i4, i5];

    const doc = new PDFDocument({ margin: 0, size: [842, 595] });
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    const pdfPromise = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(buffers))));

    doc.font('Helvetica');

    // --- ОБКЛАДИНКА (З назвою компанії та текстом) ---
    if (coverImg) doc.image(coverImg, 0, 0, { width: 842, height: 595 });
    doc.rect(0, 0, 842, 595).fillColor('#000000').fillOpacity(0.4).fill();
    doc.fillOpacity(1).fillColor('#E8454A').fontSize(24).font('Helvetica-Bold').text('BILDBODY', 80, 50);
    doc.fillColor('#FFFFFF').fontSize(60).text('30 TAGE', 80, 360);
    doc.fontSize(28).font('Helvetica').text('TRANSFORMATION GUIDE', 80, 420);
    doc.fontSize(14).text('Dein Weg zu einem gesünderen und stärkeren Ich beginnt heute.', 80, 465, { width: 400 });
    doc.fontSize(16).font('Helvetica-Bold').text(`EXKLUSIV FÜR ${customerName.toUpperCase()}`, 80, 510);

    // --- 30 СТОРІНОК (Правильні пропорції) ---
    for (let i = 1; i <= 30; i++) {
      const dayData = weekData.days[(i - 1) % 7];
      doc.addPage();
      const isLeft = i % 2 === 0;
      const img = dayImages[i % 5];

      if (img) {
        doc.save().rect(isLeft ? 0 : 421, 0, 421, 595).clip();
        doc.image(img, isLeft ? -100 : 321, 0, { height: 595 });
        doc.restore();
      }

      doc.rect(isLeft ? 421 : 0, 0, 421, 595).fill('#FFFFFF');
      doc.rect(isLeft ? 421 : 0, 0, 8, 595).fill('#E8454A');

      const x = isLeft ? 461 : 40;
      doc.fillColor('#E8454A').fontSize(110).font('Helvetica-Bold').fillOpacity(0.06).text(`${i}`, x, 40);
      doc.fillOpacity(1).fontSize(42).text(`TAG ${i}`, x, 85);
      doc.fillColor('#1A1A2E').fontSize(18).font('Helvetica-Bold').text('ERNÄHRUNG', x, 165);
      doc.fontSize(12).font('Helvetica').text(dayData.diet, x, 200, { width: 340, lineGap: 5 });
      doc.fillColor('#10B981').fontSize(18).font('Helvetica-Bold').text('TRAINING', x, 395);
      doc.fillColor('#1A1A2E').fontSize(12).font('Helvetica').text(dayData.workout, x, 430, { width: 340 });
    }

    // --- ФІНАЛЬНА СТОРІНКА ---
    doc.addPage().rect(0, 0, 842, 595).fill('#1A1A2E');
    doc.fillColor('#E8454A').fontSize(80).font('Helvetica-Bold').text('DANKE!', 0, 200, { align: 'center' });
    doc.fillColor('#FFFFFF').fontSize(20).font('Helvetica').text('Viel Erfolg auf deinem Weg! Wir glauben an dich.', 0, 300, { align: 'center' });
    doc.fontSize(24).font('Helvetica-Bold').text('BILDBODY', 0, 500, { align: 'center' });

    doc.end();
    const pdfBuffer = await pdfPromise;

    // --- ЛИСТ ---
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const htmlEmail = `
    <div style="font-family: Arial; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #E8454A; padding: 40px; text-align: center;"><h1 style="color: white; margin: 0; letter-spacing: 2px;">BILDBODY</h1></div>
      <div style="padding: 40px; color: #333;">
        <h2>Hallo ${customerName}! 👋</h2>
        <p>Wir haben deinen individuellen 30-Tage Plan erstellt.</p>
        <div style="background-color: #f0fdf4; border-left: 4px solid #10B981; padding: 20px; margin: 25px 0;">
          <strong style="color: #166534;">✅ Dein PDF-Plan ist im Anhang!</strong>
        </div>
      </div>
      <div style="background: #f9f9f9; padding: 20px; text-align: center; font-size: 11px; color: #999;">© 2026 BildBody Fitness</div>
    </div>`;

    await transporter.sendMail({
      from: `"BildBody" <${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: `✅ Dein Plan ist fertig, ${customerName}`,
      html: htmlEmail,
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
