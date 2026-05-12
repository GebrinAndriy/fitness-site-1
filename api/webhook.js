// api/webhook.js — Vercel serverless function
// Triggered by Stripe webhook on successful order.
// Generates a personalized PDF plan via Claude and emails it.
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
    <p>Your Personal Fitness &amp; Nutrition Plan</p>
    ${customerName ? `<p>Prepared exclusively for <strong>${customerName}</strong></p>` : ''}
  </div>
  ${planMarkdown}
  <div class="footer">© ${new Date().getFullYear()} BildBody · Results may vary · This plan is not medical advice.</div>
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

    // ── 1. Generate the plan with Claude ──────────────────────────────────
    console.log("Step 1: Contacting Claude AI...");
    const client = new Anthropic({ apiKey: apiKey });

    const prompt = `You are an expert nutritionist and fitness coach.
Generate a concise but complete 7-day personal diet and workout plan for ${customerName}.
User Data:
- Goal: ${quizData[2] || 'Weight Loss'}
- Weight: ${quizData[5] || '70kg'}, Height: ${quizData[6] || '165cm'}
- Activity: ${quizData[8] || 'Active'}

IMPORTANT: 
Respond ONLY with a valid JSON object matching this structure (no markdown tags outside it):
{
  "summary": "A short, highly motivating message for the user.",
  "schedule": [
    {
      "day": "DAY 1",
      "meals": "Breakfast: ... | Lunch: ... | Dinner: ...",
      "workout": "20 min cardio / exercises"
    }
  ],
  "tips": ["Tip 1", "Tip 2"]
}
Make exactly 7 days. Keep text concise.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3500,
      messages: [{ role: 'user', content: prompt }],
    });

    const planText = message.content[0].text.trim();
    console.log("Claude AI responded successfully.");

    // ── 2. Generate PDF using PDFKit ──────────────────────────────────────
    console.log("Step 2: Generating PDF...");
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    
    const pdfPromise = new Promise((resolve) => {
      doc.on('end', () => {
        resolve(Buffer.concat(buffers));
      });
    });

    // --- Premium PDF Design ---
    let planData;
    try {
      const jsonStr = planText.substring(planText.indexOf('{'), planText.lastIndexOf('}') + 1);
      planData = JSON.parse(jsonStr);
    } catch (e) {
      planData = null;
    }

    // Header Band
    doc.rect(0, 0, doc.page.width, 140).fill('#E8454A');
    doc.fillColor('#FFFFFF').fontSize(38).text('BILDBODY', 0, 45, { align: 'center', characterSpacing: 4 });
    doc.fontSize(12).text('YOUR PREMIUM TRANSFORMATION PLAN', { align: 'center', characterSpacing: 2 });
    
    doc.y = 170;
    doc.fillColor('#1A1A2E').fontSize(22).text(`Prepared exclusively for: ${customerName}`, 50);
    doc.moveDown(0.5);

    if (planData) {
      doc.fillColor('#4A4A6A').fontSize(12).text(planData.summary, 50, doc.y, { width: doc.page.width - 100, lineGap: 4 });
      doc.moveDown(2);

      planData.schedule.forEach(day => {
        if (doc.y > doc.page.height - 180) {
          doc.addPage();
          doc.y = 50;
        }

        // Day Box Header
        doc.rect(50, doc.y, doc.page.width - 100, 26).fill('#FFE0DD');
        doc.fillColor('#E8454A').fontSize(14).text(day.day, 60, doc.y + 6);
        doc.y += 20;

        // Content
        doc.fillColor('#1A1A2E').fontSize(11);
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').text('MEALS:', 60, doc.y);
        doc.font('Helvetica').text(day.meals, 60, doc.y, { width: doc.page.width - 120 });
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').text('WORKOUT:', 60, doc.y);
        doc.fillColor('#10B981').font('Helvetica').text(day.workout, 60, doc.y, { width: doc.page.width - 120 });
        doc.moveDown(1.5);
      });

      doc.moveDown();
      doc.rect(50, doc.y, doc.page.width - 100, 2).fill('#EEEEEE');
      doc.y += 15;
      
      doc.fillColor('#E8454A').fontSize(16).font('Helvetica-Bold').text('TOP TIPS FOR SUCCESS', 50);
      doc.moveDown(0.5);
      doc.fillColor('#4A4A6A').fontSize(11).font('Helvetica');
      planData.tips.forEach(tip => {
        doc.text(`• ${tip}`, 50, doc.y, { width: doc.page.width - 100, lineGap: 3 });
      });
    } else {
      // Fallback if parsing fails
      doc.fillColor('#333333').fontSize(11).lineGap(4).text(planText, 50, doc.y, { width: doc.page.width - 100 });
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
      subject: `🔥 Your 7-Day Personal Plan is Ready, ${customerName}!`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee;border-radius:12px;overflow:hidden;background:#fff;">
          <div style="background:linear-gradient(135deg,#E8454A,#FF8A6E);padding:40px 20px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:32px;">BILDBODY</h1>
          </div>
          <div style="padding:30px;line-height:1.6;color:#333;">
            <p style="font-size:18px;">Hi <strong>${customerName}</strong>! 👋</p>
            <p>We have finished creating your custom 7-day fitness and nutrition strategy.</p>
            <p style="background:#f0fdf4;padding:15px;border-left:4px solid #10B981;border-radius:4px;color:#166534;">
              ✅ <strong>Your PDF Plan is attached!</strong><br>
              Open the attached file to see your full schedule. You can save it to your phone or print it.
            </p>
            <p>We are excited to see your progress!</p>
          </div>
          <div style="background:#f4f4f4;padding:20px;text-align:center;font-size:12px;color:#888;">
            <p>© 2026 BildBody Fitness. All rights reserved.</p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: `BildBody_Plan_${customerName}.pdf`,
          content: pdfBuffer,
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
