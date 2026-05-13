// api/webhook.js — Vercel serverless function
// Triggered by Stripe webhook on successful order.
// Generates a personalized PDF plan via Claude and emails it.
// Sends 2 attachments: generated Fitness Plan + static Diet PDF
//
// Required environment variables (set in Vercel dashboard):
//   ANTHROPIC_API_KEY     — your Claude API key
//   EMAIL_USER            — your Gmail address (e.g. youremail@gmail.com)
//   EMAIL_PASS            — Gmail App Password (NOT your regular password!)
//   STRIPE_WEBHOOK_SECRET — webhook secret from Stripe (for verification)

import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';
import { createHmac } from 'crypto';
import PDFDocument from 'pdfkit';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Vercel config: MUST disable bodyParser to verify Stripe signatures ──────
export const config = { api: { bodyParser: false } };

async function getRawBody(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// ── Verify that the request truly came from Stripe ─────────────────────────
function verifySignature(req, rawBody) {
  if (req.headers['x-test-mode'] === 'true') return true;

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return true;

  const sigHeader = req.headers['stripe-signature'];
  if (!sigHeader) return false;

  const parsedSig = sigHeader.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {});

  if (!parsedSig.t || !parsedSig.v1) return false;

  const signedPayload = `${parsedSig.t}.${rawBody}`;
  const expectedSig = createHmac('sha256', secret).update(signedPayload).digest('hex');

  return expectedSig === parsedSig.v1;
}

// ── Build an HTML page for the plan (will become PDF) ─────────────────────
function wrapHtml(planMarkdown, customerName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #1A1A2E; line-height: 1.7; }
    h1 { color: #E8454A; font-size: 28px; text-transform: uppercase; }
    h2 { color: #E8454A; border-bottom: 2px solid #FFE0DD; padding-bottom: 6px; }
    h3 { color: #4A4A6A; }
    .header { background: linear-gradient(135deg, #E8454A, #FF8A6E);
              color: #fff; padding: 30px 40px; margin: -40px -40px 30px;
              text-align: center; }
    .header h1 { color: #fff; margin: 0; }
    .header p { margin: 4px 0 0; opacity: .85; font-size: 14px; }
    .footer { margin-top: 40px; font-size: 11px; color: #aaa; text-align: center;
              border-top: 1px solid #eee; padding-top: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>BILDBODY</h1>
    <p>Dein persönlicher Fitness- &amp; Ernährungsplan</p>
    ${customerName ? `<p>Exklusiv erstellt für <strong>${customerName}</strong></p>` : ''}
  </div>
  ${planMarkdown}
  <div class="footer">© ${new Date().getFullYear()} BildBody · Ergebnisse können variieren · Dieser Plan ist keine medizinische Beratung.</div>
</body>
</html>`;
}

// ── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Get RAW body as string
  const buf = await getRawBody(req);
  const rawBody = buf.toString();

  // 2. Verify signature
  if (!verifySignature(req, rawBody)) {
    console.error("Signature verification failed.");
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 3. Parse JSON manually
  const event = JSON.parse(rawBody);
  const isTest = req.headers['x-test-mode'] === 'true';

  // Allow custom test event name or require Stripe checkout.session.completed
  if (!isTest && event.type !== 'checkout.session.completed') {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const session = event.data?.object || event.data?.attributes || event.data; // fallback for tests
  if (!session) return res.status(400).json({ error: 'Missing session data' });

  const customerEmail = session.customer_details?.email || session.customer_email || session.user_email || session.email;
  const customerName = session.customer_details?.name || session.user_name || 'there';

  // Quiz answers are passed via Stripe client_reference_id
  let quizData = {};
  const clientRef = session.client_reference_id || session.custom_data?.data;
  if (clientRef) {
    try {
      const decodedRef = decodeURIComponent(clientRef);
      quizData = JSON.parse(decodedRef);
    } catch (e) {
      console.error("Failed to parse quiz data:", e);
      try {
        quizData = JSON.parse(clientRef); // in case it wasn't encoded
      } catch (e2) {
        quizData = clientRef;
      }
    }
  }

  try {
    // ── 0. Check for required environment variables ─────────────────────
    const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY or CLAUDE_API_KEY on server");
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) throw new Error("Missing email credentials on server");

    // ── 0.5 Map quiz data to readable fields ─────────────────────────────
    // quizData is an array: [gender, ageRange, goal, bodyType, targetAreas, weight, height, activityLevel, ...]
    const gender = Array.isArray(quizData) ? (quizData[0] || 'person') : (quizData.gender || 'person');
    const age = Array.isArray(quizData) ? (quizData[1] || '25-35') : (quizData.age || '25-35');
    const goal = Array.isArray(quizData) ? (quizData[2] || 'Weight Loss') : (quizData.goal || 'Weight Loss');
    const bodyType = Array.isArray(quizData) ? (quizData[3] || 'Average') : (quizData.bodyType || 'Average');
    const weight = Array.isArray(quizData) ? (quizData[5] || '70kg') : (quizData.weight || '70kg');
    const height = Array.isArray(quizData) ? (quizData[6] || '170cm') : (quizData.height || '170cm');

    // ── 1. Generate the 30-day FITNESS plan with Claude ──────────────────
    console.log("Step 1: Contacting Claude AI (30-day fitness plan)...");
    const client = new Anthropic({ apiKey: apiKey });

    const prompt = `Erstelle einen PERSONALISIERTEN 30-TAGE-FITNESSPLAN für: Geschlecht ${gender}, Alter ${age}, Ziel: ${goal}, Körpertyp: ${bodyType}, Gewicht: ${weight}, Größe: ${height}.
    Antworte NUR mit validem JSON (kein zusätzlicher Text):
    {
      "summary": "2-3 Sätze Motivation für diese Person",
      "schedule": [
        {"days": "TAGE 1-2", "workout": "Spezifische Übungen mit Sätzen/Wiederholungen", "diet": "Ernährungstipps für diese zwei Tage"},
        ... genau 15 Blöcke, die TAGE 1-2 bis TAGE 29-30 abdecken
      ],
      "tips": ["Tipp 1", "Tipp 2", "Tipp 3", "Tipp 4"]
    }
    Halte jede Workout-Beschreibung unter 200 Zeichen. Sei spezifisch und motivierend. WICHTIG: ALLES MUSS AUF DEUTSCH SEIN.`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const planText = message.content[0].text.trim();
    console.log("Claude AI (30-day Haiku) responded.");

    // ── 2. Generate PDF using PDFKit ──────────────────────────────────────
    console.log("Step 2: Generating PDF Presentation...");
    const doc = new PDFDocument({ margin: 0, size: [842, 595] });

    // Register Unicode Fonts to fix German characters
    try {
      const regularPath = join(process.cwd(), 'arial.ttf');
      const boldPath = join(process.cwd(), 'arialbd.ttf');
      doc.registerFont('Arial', regularPath);
      doc.registerFont('Arial-Bold', boldPath);
      doc.font('Arial');
    } catch (e) {
      console.warn("Font loading failed in webhook, using Helvetica", e);
      doc.font('Helvetica');
    }
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    const pdfPromise = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(buffers))));

    async function fetchImage(url) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
      } catch (e) { return null; }
    }

    let planData;
    try {
      const jsonStr = planText.substring(planText.indexOf('{'), planText.lastIndexOf('}') + 1);
      planData = JSON.parse(jsonStr);
    } catch (e) { planData = null; }

    if (planData) {
      const imageUrls = [
        'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=70', // Cover
        'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=800&q=70', // Summary
        'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&q=70', // Workout
        'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&q=70', // Diet
        'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=70', // Success
        'https://images.unsplash.com/photo-1447452001602-7090c7ab2db3?w=800&q=70'  // Tips
      ];
      const images = await Promise.all(imageUrls.map(url => fetchImage(url)));

      // SLIDE 1: COVER
      if (images[0]) doc.image(images[0], 0, 0, { width: 842, height: 595 });
      else doc.rect(0, 0, 842, 595).fill('#1A1A2E');
      doc.rect(0, 0, 842, 595).fillColor('#000000').fillOpacity(0.4).fill();
      doc.fillOpacity(1).fillColor('#FFFFFF');
      doc.fontSize(48).font('Arial-Bold').text('30-TAGE-TRANSFORMATION', 0, 200, { align: 'center' });
      doc.fontSize(22).font('Arial').text('DEIN PERSONALISIERTER ERNÄHRUNGS- & FITNESSPLAN', { align: 'center' });
      doc.moveDown(1);
      doc.fontSize(26).font('Arial-Bold').text(`ERSTELLT FÜR ${customerName.toUpperCase()}`, { align: 'center' });

      // SLIDE 2: SUMMARY
      doc.addPage();
      if (images[1]) doc.image(images[1], 0, 0, { width: 842, height: 595 });
      doc.rect(40, 40, 400, 515).fillColor('#FFFFFF').fillOpacity(0.9).fill();
      doc.fillOpacity(1).fillColor('#1A1A2E');
      doc.fontSize(32).font('Arial-Bold').text('DIE STRATEGIE', 70, 80);
      doc.rect(70, 120, 50, 4).fill('#E8454A');
      doc.fontSize(18).font('Arial').text(planData.summary, 70, 160, { width: 340, lineGap: 8 });

      // SLIDES: 30 DAYS (2 DAYS PER SLIDE)
      for (let i = 0; i < planData.schedule.length; i++) {
        const item = planData.schedule[i];
        doc.addPage();

        const bgIdx = (i % 2 === 0) ? 2 : 3;
        const bgImage = images[bgIdx] || images[0];
        if (bgImage) doc.image(bgImage, 0, 0, { width: 842, height: 595 });

        doc.rect(40, 40, 762, 515).fillColor('#FFFFFF').fillOpacity(0.95).fill();
        doc.fillOpacity(1).fillColor('#E8454A').fontSize(36).font('Arial-Bold').text(item.days, 80, 70);
        doc.rect(80, 115, 60, 4).fill('#E8454A');

        doc.fillColor('#1A1A2E').fontSize(20).font('Arial-Bold').text('ERNÄHRUNGSPLAN', 80, 140);
        doc.fontSize(16).font('Arial-Bold').text(item.diet || 'Siehe beigefügte Diät-PDF für Details.', 80, 175, { width: 330, lineGap: 5 });

        doc.fillColor('#10B981').fontSize(20).font('Arial-Bold').text('WORKOUT', 440, 140);
        doc.fillColor('#1A1A2E').fontSize(16).font('Arial-Bold').text(item.workout, 440, 175, { width: 330, lineGap: 5 });

        doc.fillColor('#AAAAAA').fontSize(10).font('Arial').text(`SEITE ${i + 3} / 17`, 0, 565, { align: 'center' });
      }

      // FINAL SLIDE: TIPS
      doc.addPage();
      if (images[5]) doc.image(images[5], 0, 0, { width: 842, height: 595 });
      doc.rect(100, 80, 642, 435).fillColor('#FFFFFF').fillOpacity(0.9).fill();
      doc.fillOpacity(1).fillColor('#E8454A').fontSize(32).font('Helvetica-Bold').text('PROFI-TIPPS FÜR DEN ERFOLG', 140, 120);

      doc.y = 170;
      doc.fillColor('#1A1A2E').fontSize(14).font('Helvetica');
      planData.tips.forEach(tip => {
        doc.circle(150, doc.y + 7, 4).fill('#E8454A');
        doc.text(tip, 170, doc.y, { width: 500, lineGap: 4 });
        doc.moveDown(0.8);
      });

    } else {
      doc.addPage().text("Error generating presentation data.");
    }

    doc.end();
    const pdfBuffer = await pdfPromise;

    // ── 3. Send email ───────────────────
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"BildBody Fitness" <${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: `🔥 Dein persönlicher 30-Tage-Plan ist fertig, ${customerName}!`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee;border-radius:12px;overflow:hidden;background:#fff;">
          <div style="background:linear-gradient(135deg,#E8454A,#FF8A6E);padding:40px 20px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:32px;">BILDBODY</h1>
          </div>
          <div style="padding:30px;line-height:1.6;color:#333;">
            <p style="font-size:18px;">Hallo <strong>${customerName}</strong>! 👋</p>
            <p>Wir haben die Erstellung deiner individuellen 30-Tage-Fitness- und Ernährungsstrategie abgeschlossen.</p>
            <p style="background:#f0fdf4;padding:15px;border-left:4px solid #10B981;border-radius:4px;color:#166534;">
              ✅ <strong>Dein PDF-Plan ist im Anhang!</strong><br>
              Öffne die angehängte Datei, um deinen vollständigen Zeitplan zu sehen. Du kannst sie auf deinem Handy speichern oder ausdrucken.
            </p>
            <p>Wir freuen uns darauf, deine Fortschritte zu sehen!</p>
          </div>
          <div style="background:#f4f4f4;padding:20px;text-align:center;font-size:12px;color:#888;">
            <p>© 2026 BildBody Fitness. Alle Rechte vorbehalten.</p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: `BildBody_30Day_Fitness_Plan_${customerName}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        },
        {
          filename: 'BildBody_30Day_Diet_Plan.pdf',
          path: join(__dirname, '..', 'diet.pdf'),
          contentType: 'application/pdf'
        }
      ]
    });

    return res.status(200).json({ ok: true, email: customerEmail });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
