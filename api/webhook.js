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

    // 1. Запит до Claude (Оптимізований для великих відповідей)
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096, // Збільшено до максимуму
      messages: [{ 
        role: 'user', 
        content: `Erstelle einen 30-Tage Plan für ${customerName}. 
        WICHTIG: Antworte NUR im JSON-Format. Beschreibe Mahlzeiten kurz (1 Satz).
        JSON: {"days": [{"day": 1, "diet": "...", "workout": "..."}]}. 
        Sprache: Deutsch.` 
      }],
    });

    const rawText = message.content[0].text.trim();
    let planData;
    try {
      const jsonStr = rawText.substring(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1);
      planData = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error("AI response was too long or malformed. Please try again.");
    }

    // 2. Преміум PDF (Векторна графіка)
    const doc = new PDFDocument({ margin: 0, size: [842, 595] });
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    const pdfPromise = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(buffers))));

    try {
      doc.registerFont('Arial', join(process.cwd(), 'arial.ttf'));
      doc.registerFont('Arial-Bold', join(process.cwd(), 'arialbd.ttf'));
      doc.font('Arial');
    } catch (e) { doc.font('Helvetica'); }

    // Cover Page
    doc.rect(0, 0, 842, 595).fill('#1A1A2E');
    doc.fillColor('#E8454A').rect(0, 200, 842, 100).fill();
    doc.fillColor('#FFFFFF').fontSize(60).font('Arial-Bold').text('30 TAGE PLAN', 0, 220, { align: 'center' });
    doc.fontSize(20).font('Arial').text(`TRANSFORMATION FÜR ${customerName.toUpperCase()}`, 0, 350, { align: 'center' });

    // Days
    planData.days.forEach((day, idx) => {
      doc.addPage();
      const isLeft = idx % 2 === 0;
      doc.rect(isLeft ? 0 : 421, 0, 421, 595).fill('#F8F9FA');
      doc.rect(isLeft ? 421 : 0, 0, 421, 595).fill('#FFFFFF');
      doc.rect(isLeft ? 421 : 0, 0, 10, 595).fill('#E8454A');
      const x = isLeft ? 461 : 50;
      doc.fillColor('#E8454A').fontSize(120).font('Arial-Bold').fillOpacity(0.05).text(`${day.day}`, x, 50);
      doc.fillOpacity(1).fontSize(38).text(`TAG ${day.day}`, x, 90);
      doc.fillColor('#1A1A2E').fontSize(18).font('Arial-Bold').text('ERNÄHRUNG', x, 160);
      doc.fontSize(13).font('Arial').text(day.diet, x, 195, { width: 330, lineGap: 5 });
      doc.fillColor('#10B981').fontSize(18).font('Arial-Bold').text('WORKOUT', x, 400);
      doc.fillColor('#1A1A2E').fontSize(13).font('Arial').text(day.workout, x, 435, { width: 330 });
    });

    doc.end();
    const pdfBuffer = await pdfPromise;

    // 3. Відправка (Фірмовий дизайн)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const htmlEmail = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #E8454A; padding: 40px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 32px; letter-spacing: 2px; text-transform: uppercase;">BILDBODY</h1>
      </div>
      <div style="padding: 40px; color: #333; line-height: 1.6;">
        <h2 style="margin-top: 0; font-size: 22px;">Hallo <strong>${customerName}</strong>! 👋</h2>
        <p>Wir haben die Erstellung deiner individuellen 30-Tage-Fitness- und Ernährungsstrategie abgeschlossen.</p>
        <div style="background-color: #f0fdf4; border-left: 4px solid #10B981; padding: 20px; margin: 25px 0; border-radius: 4px;">
          <h3 style="color: #166534; margin-top: 0; font-size: 18px;">✅ Dein PDF-Plan ist im Anhang!</h3>
          <p style="color: #166534; margin-bottom: 0; font-size: 14px;">Öffne die angehängte Datei, um deinen vollständigen Zeitplan zu sehen.</p>
        </div>
        <p>Wir freuen uns darauf, deine Fortschritte zu sehen!</p>
      </div>
      <div style="background-color: #f9f9f9; padding: 20px; text-align: center; font-size: 12px; color: #888;">
        <p>© 2026 BildBody Fitness. Alle Rechte vorbehalten.</p>
      </div>
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
