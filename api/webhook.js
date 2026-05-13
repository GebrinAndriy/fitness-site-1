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
    
    // We only care about success payments
    if (!isTest && event.type !== 'checkout.session.completed') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const session = event.data?.object || event.data;
    const customerEmail = session.customer_details?.email || session.customer_email || session.user_email || session.email;
    const customerName = session.customer_details?.name || session.user_name || 'there';

    // 1. RESPOND TO STRIPE IMMEDIATELY
    res.status(200).json({ ok: true, status: 'Processing' });

    // 2. BACKGROUND TASK
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

        const gender = Array.isArray(quizData) ? (quizData[0] || 'person') : 'person';
        const goal = Array.isArray(quizData) ? (quizData[2] || 'Weight Loss') : 'Weight Loss';

        // Claude AI
        const client = new Anthropic({ apiKey });
        const prompt = `Erstelle einen detaillierten 30-TAGE-ERNÄHRUNGSPLAN für: Geschlecht ${gender}, Alter: ..., Ziel: ${goal}. 
        Antworte NUR mit validem JSON. Das JSON muss genau 30 Tage enthalten.
        Format: {"summary": "...", "days": [{"day": 1, "diet": "Frühstück, Mittag, Abend", "workout": "..."}]}
        Sprache: Deutsch.`;

        const message = await client.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }],
        });

        const planData = JSON.parse(message.content[0].text.trim());

        // PDF
        const doc = new PDFDocument({ margin: 0, size: [842, 595] });
        try {
          doc.registerFont('Arial', join(process.cwd(), 'arial.ttf'));
          doc.registerFont('Arial-Bold', join(process.cwd(), 'arialbd.ttf'));
          doc.font('Arial');
        } catch (e) { doc.font('Helvetica'); }

        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        const pdfPromise = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(buffers))));

        async function getSafeImage(keyword) {
          try {
            const r = await fetch(`https://source.unsplash.com/800x600/?fitness,${keyword}`);
            return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
          } catch (e) { return null; }
        }

        const coverImg = await getSafeImage('workout');
        const dayImages = await Promise.all([getSafeImage('food'), getSafeImage('gym')]);

        // Cover
        if (coverImg) doc.image(coverImg, 0, 0, { width: 842, height: 595 });
        doc.rect(0, 0, 842, 595).fillColor('#000000').fillOpacity(0.5).fill();
        doc.fillOpacity(1).fillColor('#FFFFFF').fontSize(50).font('Arial-Bold').text('30-TAGE PLAN', 0, 240, { align: 'center' });
        doc.fontSize(24).text(`FÜR ${customerName.toUpperCase()}`, { align: 'center' });

        // Days (Checkerboard)
        planData.days.forEach((day, idx) => {
          doc.addPage();
          const isLeft = idx % 2 === 0;
          const img = dayImages[idx % 2];
          if (isLeft) {
            if (img) doc.image(img, 0, 0, { width: 421, height: 595 });
            doc.rect(421, 0, 421, 595).fill('#FFFFFF');
            doc.fillColor('#E8454A').fontSize(40).font('Arial-Bold').text(`TAG ${day.day}`, 461, 60);
            doc.fillColor('#1A1A2E').fontSize(14).font('Arial').text(day.diet, 461, 150, { width: 340, lineGap: 4 });
            doc.fillColor('#10B981').fontSize(22).font('Arial-Bold').text('WORKOUT', 461, 400);
            doc.fillColor('#1A1A2E').fontSize(14).font('Arial').text(day.workout, 461, 440, { width: 340 });
          } else {
            if (img) doc.image(img, 421, 0, { width: 421, height: 595 });
            doc.rect(0, 0, 421, 595).fill('#FFFFFF');
            doc.fillColor('#E8454A').fontSize(40).font('Arial-Bold').text(`TAG ${day.day}`, 40, 60);
            doc.fillColor('#1A1A2E').fontSize(14).font('Arial').text(day.diet, 40, 150, { width: 340, lineGap: 4 });
            doc.fillColor('#10B981').fontSize(22).font('Arial-Bold').text('WORKOUT', 40, 400);
            doc.fillColor('#1A1A2E').fontSize(14).font('Arial').text(day.workout, 40, 440, { width: 340 });
          }
        });

        doc.end();
        const pdfBuffer = await pdfPromise;

        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        });

        await transporter.sendMail({
          from: `"BildBody" <${process.env.EMAIL_USER}>`,
          to: customerEmail,
          subject: `✅ Dein 30-Tage Plan ist fertig, ${customerName}`,
          html: `<p>Hallo ${customerName}, dein Plan ist fertig!</p>`,
          attachments: [
            { filename: `Plan_${customerName}.pdf`, content: pdfBuffer },
            { filename: 'Premium_Guide.pdf', path: join(process.cwd(), 'diet.pdf') }
          ]
        });
      } catch (err) {
        console.error("BG Error:", err);
      }
    })();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
